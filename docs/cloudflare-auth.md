# Cloudflare authentication for multiplayer services

The game code stays provider-agnostic. Cloudflare authentication belongs at the
deployment boundary, so future games can reuse the same deployment path.

There are two supported methods.

## Method 1: OAuth for an interactive machine

Use this when an agent or developer needs to run Wrangler directly on a machine.
Each machine gets its own revocable OAuth session; no API token is shared.

```bash
npx wrangler login --use-keyring
npx wrangler whoami
```

Wrangler stores the OAuth credentials in the machine's secure keychain when
`--use-keyring` is enabled.

### Phone-only login for a remote machine

If the machine has no usable browser:

1. Leave `npx wrangler login --use-keyring` running on the remote machine.
2. Open the printed Cloudflare OAuth URL on the phone and approve access.
3. Cloudflare may redirect the phone to a `localhost:8976` callback that cannot
   load on the phone.
4. Copy the complete callback URL from the phone address bar.
5. Deliver that URL to a private terminal relay, then run it from a second shell
   on the remote machine:

   ```bash
   curl '<one-time-localhost-callback-url>'
   ```

6. Confirm the session:

   ```bash
   npx wrangler whoami
   ```

The callback URL contains a one-time authorization code. Do not put it in a
public issue, commit, log, or shared channel. It should be used only for the
currently running login attempt.

## Method 2: Account API token for headless agents and CI

Use this when agents must deploy without interactive browser authentication.
Prefer an account-owned API token over a personal global API key.

From the Cloudflare dashboard on the phone:

1. Open **Manage Account → API Tokens**.
2. Create an **Account API Token**.
3. Use the **Edit Cloudflare Workers** template, or a custom token with only
   the Worker deployment permissions needed by this repository.
4. Restrict the token to this Cloudflare account.
5. Copy the secret once and store it in a password manager or secret store.

For a manually operated machine, inject the values without committing them:

```bash
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
read -rsp 'Cloudflare API token: ' CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
printf '\n'
npx wrangler deploy --config services/sternenpfad-room/wrangler.jsonc
```

For GitHub Actions, add these repository or environment secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

The generic workflow at
`.github/workflows/deploy-cloudflare-service.yml` consumes those secrets and
accepts a service directory as a manual input. The token never enters the
repository or an agent prompt.

## Which method should future agents use?

| Agent type | Recommended authentication |
| --- | --- |
| Developer or interactive local agent | OAuth with `wrangler login --use-keyring` |
| Remote agent with a browser available | OAuth with `wrangler login --use-keyring` |
| Remote/headless agent | Account API token injected as an environment secret |
| GitHub-based deployment | GitHub Actions secrets and the reusable workflow |

Rotate or revoke a token from the Cloudflare dashboard if a machine is lost or
an agent is retired. Never use the Global API Key for this project.

## References

- [Wrangler authentication and remote login](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Cloudflare account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
- [Cloudflare GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
