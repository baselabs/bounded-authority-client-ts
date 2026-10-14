# Security policy

## Supported versions

No version of `@bounded-authority/client` is on npm yet; 0.1.1 will be the first. Until then,
security fixes land on `main` and in the next version.

The package computes the bytes a client sends to a bounded authority service. It holds no keys,
signs nothing, calls no service, and makes no authorization decision. A security problem here is,
for example, a digest that differs from the contract's bytes, an input the contract refuses that
the package accepts, a public function that throws instead of returning the closed error, or code
in `src/` that only runs in Node.js.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**
([direct link](https://github.com/baselabs/bounded-authority-client-ts/security/advisories/new)).
Do not open a public issue containing an exploit, a credential, a private key, production data,
or details of an unfixed vulnerability.

A useful report names the affected version or commit, the rule the package breaks (with a link
to [`docs/req2-projection.md`](docs/req2-projection.md) or the code), a minimal reproduction that
uses demo values, and the result you expected. We acknowledge the report, triage it, and coordinate
the fix and its disclosure through the private advisory.
