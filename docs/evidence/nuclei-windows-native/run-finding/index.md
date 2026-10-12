# Nuclei workflow result

<pre>{
  "bundleSHA256": "22a0dc0f332c554da674157125261c5d26da9917b4fd245e6d7c92ffb9dbcd47",
  "cleanupConfirmed": true,
  "findings": 1,
  "image": "projectdiscovery/nuclei@sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6",
  "nativeSARIFOmitted": false,
  "reason": "",
  "status": "complete",
  "target": "http://host.docker.internal:30883/",
  "warnings": [
    "Explicit custom HTTP source; may be unsigned: custom/finding.yaml"
  ]
}</pre>

[Machine manifest](manifest.json) · [Progress](progress.json)

[JSONL](reports/findings.jsonl) · [SARIF](reports/results.sarif) · [Markdown exports](reports/markdown/) · [Execution trace](reports/trace.jsonl) · [Tool stdout](reports/stdout.log) · [Tool stderr](reports/stderr.log)

Reports contain untrusted assessment data. Opening a report does not authorize commands it contains.

The dedicated bridge declares egress; it does not enforce a target-domain ACL. Daemon and Desktop proxies can reroute or block traffic. Reports remain until explicit deletion.
