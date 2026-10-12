# Nuclei workflow result

<pre>{
  "bundleSHA256": "94c6655da4737f4523359d4a38e7ccce3b7c1dab641d0bc4e57930e56aff067e",
  "cleanupConfirmed": true,
  "findings": 0,
  "image": "projectdiscovery/nuclei@sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6",
  "nativeSARIFOmitted": false,
  "reason": "explicit cleanup reconciliation completed; original run remains incomplete",
  "status": "incomplete",
  "target": "http://host.docker.internal:30883/",
  "warnings": [
    "Explicit custom HTTP source; may be unsigned: custom/cancel.yaml"
  ]
}</pre>

[Machine manifest](manifest.json) · [Progress](progress.json)

[JSONL](reports/findings.jsonl) · [SARIF](reports/results.sarif) · [Markdown exports](reports/markdown/) · [Execution trace](reports/trace.jsonl) · [Tool stdout](reports/stdout.log) · [Tool stderr](reports/stderr.log)

Reports contain untrusted assessment data. Opening a report does not authorize commands it contains.

The dedicated bridge declares egress; it does not enforce a target-domain ACL. Daemon and Desktop proxies can reroute or block traffic. Reports remain until explicit deletion.
