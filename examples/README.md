# Deployment examples

These examples use the actual installer and existing root `compose.yaml`. The installer creates directories, keys and permissions; copying an environment file alone does not initialize a deployment.

```sh
PUBLIC_ORIGIN=https://mail.example.org bash examples/install-unattended.sh
```

Replace the example origin with your existing HTTPS reverse-proxy origin. Optional environment variables are `INSTALL_DIR`, `CONTAINER_NAME`, `PORT` and `MAIL_WEB_REPOSITORY`. Additional installer flags may be passed as arguments. The script downloads the bootstrap and starts installation; it does not configure a reverse proxy or Stalwart.

[infrastructure.env.example](infrastructure.env.example) mirrors the root [.env.example](../.env.example) for reference. Site names, mail domains and service credentials are configured through the protected web console after installation. The default deployment loads the verified bundled image and does not pull it from a registry.

See the [deployment guide](../docs/deployment.md) for HTTP mode, IPv6, upgrades and backups, and the [Stalwart guide](../docs/stalwart-setup.md) for service setup.
