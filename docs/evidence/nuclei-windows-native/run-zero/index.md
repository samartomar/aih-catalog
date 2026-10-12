# Nuclei workflow result

<pre>{
  "bundleSHA256": "ddf370238b3e5e8e5334af9694674d60256f0538623403c2372cfc4eddb5bb35",
  "cleanupConfirmed": true,
  "findings": 0,
  "image": "projectdiscovery/nuclei@sha256:9fd705284ac4b5f721fa1e23bf366f26e985cd4ec65927fe9a53cb3fcb0417a6",
  "nativeSARIFOmitted": true,
  "reason": "",
  "status": "complete",
  "target": "http://host.docker.internal:30883/",
  "warnings": [
    "Explicit custom HTTP source; may be unsigned: custom/zero.yaml"
  ]
}</pre>

[Machine manifest](manifest.json) · [Progress](progress.json)

[JSONL](reports/findings.jsonl) · SARIF: Nuclei omitted this native export for the verified empty findings result · [Markdown exports](reports/markdown/) · [Execution trace](reports/trace.jsonl) · [Tool stdout](reports/stdout.log) · [Tool stderr](reports/stderr.log)

Reports contain untrusted assessment data. Opening a report does not authorize commands it contains.

The dedicated bridge declares egress; it does not enforce a target-domain ACL. Daemon and Desktop proxies can reroute or block traffic. Reports remain until explicit deletion.
