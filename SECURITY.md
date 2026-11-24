# Security policy

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/galacean/design-bridge/security/advisories/new)
when private reporting is enabled. Include the package and version, a minimal reproduction, input trust assumptions,
and expected impact. Do not put credentials, private designs, or exploit payloads in a public issue.

If the private reporting form is unavailable, open an issue requesting a private reporting channel without disclosing
vulnerability details. Maintainers must enable private vulnerability reporting before a public release.

Security fixes target the latest published version of each affected package. Older versions receive fixes at the
maintainers' discretion. `figma2ge` is under development; its input coverage and API can change. Package versions in
this repository describe development snapshots and do not imply that a release has been published.

Converters parse complex, potentially hostile data. Applications must limit input bytes, archive expansion, dimensions,
layer counts, and processing time, and isolate conversions of untrusted input. Validation checks format consistency;
it is not a guarantee that rendering or opening the result is safe.

`html2figma` loads HTML in Chromium or an iframe. Browser `sandboxed` mode separates the input origin but still allows
network requests; `disabled` blocks input scripts but does not disable images or fonts. `trusted` grants normal document
permissions. The Node entry reads files, executes HTML scripts, and may download resources. Its Node options include script control, offline network mode, a 10 MiB HTML input limit,
and a 30-second extraction deadline. Offline mode blocks HTTP(S) requests and Node font/icon downloads, but does not
jail local file access or apply to separate file/clipboard generation calls. Use trusted inputs or run it in an isolated process with OS-level file and network
restrictions, a working-directory allowlist, input/resource limits, and an external deadline. Never supply credentials
to untrusted HTML. Do not expose the development workbench or its local file APIs to a public network.

Optional particle generation is disabled until explicitly configured. Endpoint credentials remain in the local server
environment. The public adapter limits JSON request/response bodies to 1 MiB, uses a 60-second upstream deadline,
rejects redirects, and validates returned DSL. It never reads personal authentication files. Adapter implementations
are responsible for their own authentication and resource policies.
