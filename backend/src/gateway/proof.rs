//! Private ownership proofs produced by the unmodified Stalwart Sieve signer.
//! DKIM parsing, canonicalization and verification use Stalwart's mail-auth library.
use mail_auth::{
    AuthenticatedMessage, DkimResult, DnsCache, MessageAuthenticator, Parameters, ResolverCache,
    TxtRecord,
    dkim::{DkimError, DomainKey},
    dns::{NoCache, TxtRecordParser},
};
use std::{borrow::Borrow, collections::HashMap, hash::Hash, sync::Arc, time::Instant};

pub struct PinnedKey {
    name: Box<str>,
    record: TxtRecord,
}
impl ResolverCache<Box<str>, TxtRecord> for PinnedKey {
    fn get<Q>(&self, name: &Q) -> Option<TxtRecord>
    where
        Box<str>: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        // A miss is an explicit negative answer, never a public DNS fallback.
        Some(if <Box<str> as Borrow<Q>>::borrow(&self.name) == name {
            self.record.clone()
        } else {
            TxtRecord::Error(mail_auth::Error::Parse)
        })
    }
    fn remove<Q>(&self, _: &Q) -> Option<TxtRecord>
    where
        Box<str>: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        None
    }
    fn insert(&self, _: Box<str>, _: TxtRecord, _: Instant) {}
}
impl DnsCache for PinnedKey {
    type Txt = Self;
    type Mx = NoCache;
    type Ipv4 = NoCache;
    type Ipv6 = NoCache;
    type Ptr = NoCache;
    fn txt(&self) -> Option<&Self> {
        Some(self)
    }
    fn mx(&self) -> Option<&NoCache> {
        None
    }
    fn ipv4(&self) -> Option<&NoCache> {
        None
    }
    fn ipv6(&self) -> Option<&NoCache> {
        None
    }
    fn ptr(&self) -> Option<&NoCache> {
        None
    }
}

/// Verify the outermost DKIM header against an installation-owned key. Never
/// fall back to an inner signature: redirected mail can contain another user's
/// valid proof, and vacation's From and reverse-path do not identify its owner.
pub async fn verify<'a>(raw: &[u8], keys: &'a HashMap<String, String>) -> Option<&'a str> {
    let mut message = AuthenticatedMessage::parse(raw)?;
    let first_raw = message
        .headers()
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(b"DKIM-Signature"))?
        .1;
    let first = message.dkim_signatures().first()?;
    if first.value != first_raw || first.header.l != 0 || first.header.atps.is_some() {
        return None;
    }
    let domain = first.header.d.to_ascii_lowercase();
    let public_key = keys.get(&domain)?;
    if first.header.s != "mw-proof" {
        return None;
    }
    let record = DomainKey::parse(format!("v=DKIM1; k=ed25519; p={public_key}").as_bytes()).ok()?;
    let cache = PinnedKey {
        name: format!("mw-proof._domainkey.{domain}.").into_boxed_str(),
        record: TxtRecord::DomainKey(Arc::new(record)),
    };
    let mut index = 0;
    message.retain_dkim_signatures(|_| {
        index += 1;
        if index == 1 {
            Ok(())
        } else {
            Err(DkimError::UnsupportedVersion)
        }
    });
    // The resolver is never contacted; every TXT lookup has a pinned or negative entry.
    let authenticator = MessageAuthenticator::new_doh("https://invalid.invalid/dns-query");
    let result = authenticator
        .verify_dkim(Parameters::new(&message).with_cache(&cache))
        .await;
    result
        .iter()
        .any(|output| {
            output
                .signature()
                .is_some_and(|s| s.d.eq_ignore_ascii_case(&domain))
                && output.result() == &DkimResult::Pass
        })
        .then(|| keys.get_key_value(&domain).unwrap().0.as_str())
}

/// Remove the verified outer proof without reserializing the remaining message.
pub fn strip(raw: &[u8]) -> Option<Vec<u8>> {
    let message = AuthenticatedMessage::parse(raw)?;
    let (name, value) = message
        .headers()
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(b"DKIM-Signature"))?;
    let start = name.as_ptr() as usize - raw.as_ptr() as usize;
    let end = value.as_ptr() as usize - raw.as_ptr() as usize + value.len();
    let mut result = Vec::with_capacity(raw.len() - (end - start));
    result.extend_from_slice(&raw[..start]);
    result.extend_from_slice(&raw[end..]);
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn keys() -> HashMap<String, String> {
        [(
            "owner.proof.probe.example.com".into(),
            include_str!("../../testdata/gateway/public-key.txt")
                .trim()
                .into(),
        )]
        .into()
    }
    #[tokio::test]
    async fn official_redirect_and_forged_from_vacation_verify_without_dns() {
        for raw in [
            include_bytes!("../../testdata/gateway/redirect.eml").as_slice(),
            include_bytes!("../../testdata/gateway/vacation.eml").as_slice(),
        ] {
            let keys = keys();
            assert_eq!(
                verify(raw, &keys).await,
                Some("owner.proof.probe.example.com")
            );
            let stripped = strip(raw).unwrap();
            assert!(verify(&stripped, &keys).await.is_none());
            assert_eq!(
                AuthenticatedMessage::parse(raw).unwrap().raw_body(),
                AuthenticatedMessage::parse(&stripped).unwrap().raw_body()
            );
            let mut changed = raw.to_vec();
            changed.extend_from_slice(b"Changed body\r\n");
            assert!(verify(&changed, &keys).await.is_none());
            let mut forged = b"DKIM-Signature: invalid\r\n".to_vec();
            forged.extend_from_slice(raw);
            assert!(verify(&forged, &keys).await.is_none());
            let wrong = [(
                "owner.proof.probe.example.com".into(),
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
            )]
            .into();
            assert!(verify(raw, &wrong).await.is_none());
        }
    }
}
