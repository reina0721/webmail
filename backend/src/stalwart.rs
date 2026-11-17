use reqwest::Client;
use serde_json::{Value, json};

#[derive(Clone)]
pub struct Stalwart {
    pub http: Client,
    pub base: String,
}

#[derive(thiserror::Error, Debug)]
pub enum UpstreamError {
    #[error("upstream unavailable")]
    Transport(#[from] reqwest::Error),
    #[error("upstream authentication failed")]
    Authentication,
    #[error("upstream rate limited")]
    RateLimited,
    #[error("upstream rejected operation")]
    Rejected,
    #[error("upstream confirmed object rejection")]
    ObjectRejected,
    #[error("unexpected upstream response")]
    Protocol,
}

impl Stalwart {
    pub async fn password_session(
        &self,
        email: &str,
        password: &str,
    ) -> Result<Value, UpstreamError> {
        let response = self
            .http
            .get(format!("{}/jmap/session", self.base))
            .basic_auth(email, Some(password))
            .send()
            .await?;
        if response.status() == 429 {
            return Err(UpstreamError::RateLimited);
        }
        if matches!(response.status().as_u16(), 401 | 403) {
            return Err(UpstreamError::Authentication);
        }
        if !response.status().is_success() {
            return Err(UpstreamError::Protocol);
        }
        Ok(response.json().await?)
    }
    pub async fn session(&self, key: &str) -> Result<Value, UpstreamError> {
        let response = self
            .http
            .get(format!("{}/jmap/session", self.base))
            .bearer_auth(key)
            .send()
            .await?;
        if response.status() == 429 {
            return Err(UpstreamError::RateLimited);
        }
        if response.status() == 401 || response.status() == 403 {
            return Err(UpstreamError::Authentication);
        }
        if !response.status().is_success() {
            return Err(UpstreamError::Protocol);
        }
        Ok(response.json().await?)
    }
    pub async fn call(&self, key: &str, method: &str, args: Value) -> Result<Value, UpstreamError> {
        self.request(
            self.http
                .post(format!("{}/jmap/", self.base))
                .bearer_auth(key),
            method,
            args,
        )
        .await
    }
    pub async fn password_call(
        &self,
        email: &str,
        password: &str,
        method: &str,
        args: Value,
    ) -> Result<Value, UpstreamError> {
        self.request(
            self.http
                .post(format!("{}/jmap/", self.base))
                .basic_auth(email, Some(password)),
            method,
            args,
        )
        .await
    }
    async fn request(
        &self,
        req: reqwest::RequestBuilder,
        method: &str,
        args: Value,
    ) -> Result<Value, UpstreamError> {
        let using = if method.starts_with("x:") {
            json!(["urn:ietf:params:jmap:core", "urn:stalwart:jmap"])
        } else if method.starts_with("Blob/") {
            json!(["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"])
        } else {
            json!([
                "urn:ietf:params:jmap:core",
                "urn:ietf:params:jmap:mail",
                "urn:ietf:params:jmap:submission"
            ])
        };
        let response = req
            .json(&json!({"using":using,"methodCalls":[[method,args,"c"]]}))
            .send()
            .await?;
        if response.status() == 429 {
            return Err(UpstreamError::RateLimited);
        }
        if response.status() == 401 || response.status() == 403 {
            return Err(UpstreamError::Authentication);
        }
        if !response.status().is_success() {
            return Err(UpstreamError::Rejected);
        }
        let body: Value = response.json().await?;
        let call = body
            .get("methodResponses")
            .and_then(Value::as_array)
            .and_then(|v| v.first())
            .ok_or(UpstreamError::Protocol)?;
        if call[0] != method {
            tracing::warn!(
                method,
                error_type = call[1]["type"].as_str().unwrap_or("unknown"),
                "upstream_method_rejected"
            );
            return Err(UpstreamError::Rejected);
        }
        let result = call[1].clone();
        for field in ["notCreated", "notUpdated", "notDestroyed"] {
            if result
                .get(field)
                .and_then(Value::as_object)
                .is_some_and(|v| !v.is_empty())
            {
                if let Some(error) = result[field]
                    .as_object()
                    .and_then(|errors| errors.values().next())
                {
                    tracing::warn!(
                        method,
                        error_type = error["type"].as_str().unwrap_or("unknown"),
                        "upstream_object_rejected"
                    );
                }
                return Err(UpstreamError::ObjectRejected);
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        http::StatusCode,
        routing::{get, post},
    };
    #[tokio::test]
    async fn preserves_explicit_upstream_throttling_and_temporary_upload_quota() {
        let app = Router::new()
            .route(
                "/jmap/session",
                get(|| async { StatusCode::TOO_MANY_REQUESTS }),
            )
            .route("/jmap/", post(|| async { StatusCode::TOO_MANY_REQUESTS }))
            .route(
                "/upload",
                get(|| async {
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        [("ratelimit-policy", "\"blob-upload-bytes\";q=50000000")],
                    )
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let upstream = Stalwart {
            http: Client::new(),
            base: format!("http://{address}"),
        };
        assert!(matches!(
            upstream.session("synthetic").await,
            Err(UpstreamError::RateLimited)
        ));
        assert!(matches!(
            upstream.password_session("synthetic", "synthetic").await,
            Err(UpstreamError::RateLimited)
        ));
        assert!(matches!(
            upstream.call("synthetic", "Email/get", json!({})).await,
            Err(UpstreamError::RateLimited)
        ));
        let response = upstream
            .http
            .get(format!("http://{address}/upload"))
            .send()
            .await
            .unwrap();
        let error = crate::pim::upload_response_error(&response).unwrap();
        assert_eq!(error.0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(error.1, "upload_quota_exceeded");
        server.abort();
    }
}
