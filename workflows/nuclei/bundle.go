package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

const maxArchive = 64 << 20
const maxExpanded = 256 << 20
const maxEntries = 4096

func filepathDir(p string) string { return filepath.Dir(p) }
func digest(b []byte) string      { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func hasControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}
func portablePath(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || strings.ContainsAny(part, `<>"|?*`) {
			return false
		}
		for _, r := range part {
			if r > 127 {
				return false
			}
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || regexp.MustCompile(`^(COM|LPT)[1-9]$`).MatchString(base) {
			return false
		}
	}
	return true
}
func pathCollision(files map[string][]byte, p string) bool {
	for existing := range files {
		a, b := strings.Split(existing, "/"), strings.Split(p, "/")
		for i := 0; i < min(len(a), len(b)); i++ {
			if !strings.EqualFold(a[i], b[i]) {
				break
			}
			if a[i] != b[i] {
				return true
			}
		}
		if strings.EqualFold(existing, p) || strings.HasPrefix(strings.ToLower(existing), strings.ToLower(p)+"/") || strings.HasPrefix(strings.ToLower(p), strings.ToLower(existing)+"/") {
			return true
		}
	}
	return false
}
func safePath(p string) bool {
	return portablePath(p) && p != "" && !strings.EqualFold(p, "bundle-manifest.json") && !hasControl(p) && p == path.Clean(p) && !strings.HasPrefix(p, "/") && !strings.Contains(p, "\\") && !strings.Contains(p, ":") && p != ".." && !strings.HasPrefix(p, "../") && len(strings.Split(p, "/")) <= 16 && !strings.ContainsAny(p, "\x00\r\n\t,")
}
func readRegular(p string, max int64) ([]byte, error) {
	s, e := os.Lstat(p)
	if e != nil {
		return nil, e
	}
	if !s.Mode().IsRegular() || s.Size() > max {
		return nil, errors.New("not a bounded regular file")
	}
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if len(b) > int(max) {
		return nil, errors.New("file exceeds bound")
	}
	return b, e
}

type member struct {
	Path     string `json:"path"`
	SHA256   string `json:"sha256"`
	Bytes    int    `json:"bytes"`
	Template bool   `json:"template"`
	ID       string `json:"id,omitempty"`
}
type bundleManifest struct {
	Version  int      `json:"version"`
	Outcome  string   `json:"outcome"`
	Tag      string   `json:"tag,omitempty"`
	Commit   string   `json:"commit,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	Files    []member `json:"files"`
	SHA256   string   `json:"sha256,omitempty"`
	Bytes    int64    `json:"bytes,omitempty"`
}

func loadBundle(p, h string, n int64) (map[string][]byte, bundleManifest, error) {
	var m bundleManifest
	if n < 1 || n > maxArchive || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(h) {
		return nil, m, errors.New("invalid bundle identity")
	}
	b, e := readRegular(p, maxArchive)
	if e != nil {
		return nil, m, e
	}
	if int64(len(b)) != n || digest(b) != h {
		return nil, m, errors.New("bundle identity mismatch")
	}
	z, e := gzip.NewReader(bytes.NewReader(b))
	if e != nil {
		return nil, m, e
	}
	defer z.Close()
	tr := tar.NewReader(io.LimitReader(z, maxExpanded+maxEntries*1024+1))
	files := map[string][]byte{}
	var total int64
	for count := 0; ; count++ {
		hdr, e := tr.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, m, e
		}
		if count >= maxEntries || (!safePath(hdr.Name) && hdr.Name != "bundle-manifest.json") || hdr.Typeflag != tar.TypeReg || hdr.Size < 0 || hdr.Size > maxExpanded {
			return nil, m, errors.New("unsafe archive member")
		}
		if pathCollision(files, hdr.Name) {
			return nil, m, errors.New("duplicate archive member")
		}
		total += hdr.Size
		if total > maxExpanded {
			return nil, m, errors.New("expanded archive bound exceeded")
		}
		v, e := io.ReadAll(io.LimitReader(tr, hdr.Size+1))
		if e != nil || int64(len(v)) != hdr.Size {
			return nil, m, errors.New("truncated archive member")
		}
		files[hdr.Name] = v
	}
	raw, ok := files["bundle-manifest.json"]
	if !ok {
		return nil, m, errors.New("bundle manifest missing")
	}
	if e = json.Unmarshal(raw, &m); e != nil {
		return nil, m, e
	}
	delete(files, "bundle-manifest.json")
	if m.Version != 1 || len(m.Files) == 0 || len(m.Files) != len(files) {
		return nil, m, errors.New("bundle manifest inventory mismatch")
	}
	seen := map[string]bool{}
	templates := 0
	ids := map[string]bool{}
	for _, f := range m.Files {
		b, ok := files[f.Path]
		if !ok || seen[f.Path] || digest(b) != f.SHA256 || len(b) != f.Bytes {
			return nil, m, errors.New("bundle manifest identity mismatch")
		}
		seen[f.Path] = true
		if !f.Template {
			if e := validateExpressions(string(b), false); e != nil {
				return nil, m, e
			}
		}
		if f.Template {
			templates++
			if ids[f.ID] {
				return nil, m, errors.New("duplicate template id")
			}
			ids[f.ID] = true
			id, e := validateTemplate(b, files)
			if e != nil || id != f.ID {
				return nil, m, fmt.Errorf("template %s rejected: %v", f.Path, e)
			}
		}
	}
	if templates == 0 {
		return nil, m, errors.New("no selected HTTP templates")
	}
	return files, m, nil
}
func validateTemplate(b []byte, files map[string][]byte) (string, error) {
	if len(b) > 2<<20 {
		return "", errors.New("template too large")
	}
	var root yaml.Node
	d := yaml.NewDecoder(bytes.NewReader(b))
	if e := d.Decode(&root); e != nil {
		return "", e
	}
	var extra yaml.Node
	if e := d.Decode(&extra); e != io.EOF {
		return "", errors.New("multiple YAML documents")
	}
	if len(root.Content) != 1 || root.Content[0].Kind != yaml.MappingNode {
		return "", errors.New("expected mapping")
	}
	r := root.Content[0]
	allowed := map[string]bool{"id": true, "info": true, "http": true, "variables": true, "constants": true}
	id := ""
	hasHTTP := false
	for i := 0; i < len(r.Content); i += 2 {
		k, v := r.Content[i].Value, r.Content[i+1]
		if !allowed[k] {
			return "", fmt.Errorf("unsupported root capability %q", k)
		}
		if k == "id" {
			id = v.Value
		}
		if k == "http" {
			hasHTTP = v.Kind == yaml.SequenceNode && len(v.Content) > 0
			// Keep the standard, rate-limited request path finite. New execution or
			// routing capabilities must be assessed before they enter this subset.
			fields := map[string]bool{}
			for _, field := range []string{"id", "name", "path", "raw", "method", "body", "headers", "payloads", "attack", "matchers", "matchers-condition", "extractors", "threads", "max-size", "max-redirects", "cookie-reuse", "disable-cookie", "read-all", "redirects", "host-redirects", "protocol-redirects", "req-condition", "stop-at-first-match", "skip-variables-check", "iterate-all", "disable-path-automerge"} {
				fields[field] = true
			}
			for _, request := range v.Content {
				if request.Kind != yaml.MappingNode {
					return "", errors.New("HTTP request must be a mapping")
				}
				for j := 0; j < len(request.Content); j += 2 {
					field, value := request.Content[j].Value, request.Content[j+1]
					if !fields[field] {
						return "", fmt.Errorf("unsupported HTTP request capability %q", field)
					}
					switch field {
					case "path", "raw":
						if value.Kind != yaml.SequenceNode {
							return "", errors.New("HTTP path/raw must be a sequence")
						}
						for _, item := range value.Content {
							if item.Kind != yaml.ScalarNode || item.Tag != "!!str" {
								return "", errors.New("HTTP path/raw entries must be literal strings")
							}
						}
					case "matchers", "extractors":
						if value.Kind != yaml.SequenceNode {
							return "", errors.New("HTTP operators must be a sequence")
						}
						for _, item := range value.Content {
							if item.Kind != yaml.MappingNode {
								return "", errors.New("HTTP operator must be a mapping")
							}
						}
					}
				}
			}
		}
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_.-]{1,200}$`).MatchString(id) || !hasHTTP {
		return "", errors.New("id and nonempty HTTP requests required")
	}
	// Nuclei merges template-defined values after target-derived values. Reserve
	// every upstream KnownVariable plus the HTTP context IP so expressions cannot
	// replace the approved URL/authority through another definition surface.
	reserved := map[string]bool{}
	for _, v := range []string{"baseurl", "rooturl", "hostname", "host", "port", "path", "query", "file", "scheme", "input", "fqdn", "rdn", "dn", "tld", "sd", "ip"} {
		reserved[v] = true
	}
	checkName := func(n *yaml.Node) error {
		if n.Kind != yaml.ScalarNode || n.Tag != "!!str" || !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]*$`).MatchString(n.Value) {
			return errors.New("unsupported variable name")
		}
		if reserved[strings.ToLower(n.Value)] {
			return fmt.Errorf("reserved target variable %q may not be shadowed", n.Value)
		}
		return nil
	}
	var definitions func(*yaml.Node, string) error
	definitions = func(n *yaml.Node, key string) error {
		if key == "constants" || key == "variables" || key == "payloads" {
			if n.Kind != yaml.MappingNode {
				return errors.New("variable definitions must be a mapping")
			}
			for i := 0; i < len(n.Content); i += 2 {
				if e := checkName(n.Content[i]); e != nil {
					return e
				}
				v := n.Content[i+1]
				if key == "variables" && (strings.Contains(v.Value, "{{") || strings.Contains(v.Value, "}}") || strings.Contains(v.Value, "§")) {
					return errors.New("root variables must be literal scalar data; repeated expression evaluation is unsupported")
				}
				if key != "payloads" && v.Kind != yaml.ScalarNode {
					return errors.New("only scalar template variables/constants supported")
				}
			}
		}
		if key == "variables" || key == "constants" || key == "payloads" {
			return nil
		}
		if key == "extractors" {
			if n.Kind != yaml.SequenceNode {
				return errors.New("extractors must be a sequence")
			}
			for _, ex := range n.Content {
				if ex.Kind != yaml.MappingNode {
					return errors.New("extractor must be a mapping")
				}
				for i := 0; i < len(ex.Content); i += 2 {
					if ex.Content[i].Value == "name" {
						if e := checkName(ex.Content[i+1]); e != nil {
							return e
						}
					}
				}
			}
		}
		if key == "extractors" {
			return nil
		}
		if n.Kind == yaml.MappingNode {
			for i := 0; i < len(n.Content); i += 2 {
				if e := definitions(n.Content[i+1], n.Content[i].Value); e != nil {
					return e
				}
			}
		} else if n.Kind == yaml.SequenceNode {
			for _, v := range n.Content {
				if e := definitions(v, ""); e != nil {
					return e
				}
			}
		}
		return nil
	}
	if e := definitions(r, ""); e != nil {
		return "", e
	}
	var walk func(*yaml.Node, string) error
	walk = func(n *yaml.Node, key string) error {
		if n.Kind == yaml.AliasNode || n.Anchor != "" {
			return errors.New("YAML aliases/anchors unsupported")
		}
		switch n.Kind {
		case yaml.MappingNode:
			if n.Tag != "!!map" {
				return errors.New("custom YAML mapping tags unsupported")
			}
			for i := 0; i < len(n.Content); i += 2 {
				if n.Content[i].Kind != yaml.ScalarNode || n.Content[i].Tag != "!!str" {
					return errors.New("YAML keys must be literal strings; merges unsupported")
				}
			}
		case yaml.SequenceNode:
			if n.Tag != "!!seq" {
				return errors.New("custom YAML sequence tags unsupported")
			}
		case yaml.ScalarNode:
			switch n.Tag {
			case "!!str", "!!bool", "!!int", "!!float", "!!null":
			default:
				return errors.New("encoded/custom YAML scalar tags unsupported")
			}
		}

		if key == "headers" {
			if n.Kind != yaml.MappingNode {
				return errors.New("headers must be a mapping")
			}
			hostCount := 0
			for i := 0; i < len(n.Content); i += 2 {
				if strings.EqualFold(n.Content[i].Value, "host") {
					hostCount++
					if n.Content[i+1].Kind != yaml.ScalarNode || n.Content[i+1].Value != "{{Hostname}}" {
						return errors.New("structured Host must be exact target Hostname")
					}
				}
			}
			if hostCount > 1 {
				return errors.New("duplicate Host header")
			}
		}
		if n.Kind == yaml.MappingNode {
			seen := map[string]bool{}
			for i := 0; i < len(n.Content); i += 2 {
				k, v := n.Content[i].Value, n.Content[i+1]
				if seen[k] {
					return errors.New("duplicate YAML key")
				}
				seen[k] = true
				switch strings.ToLower(k) {
				case "code", "javascript", "headless", "interactsh", "self-contained", "global-matchers", "unsafe":
					return fmt.Errorf("restricted capability %q", k)
				}
				if e := walk(v, k); e != nil {
					return e
				}
			}
			return nil
		}
		if n.Kind == yaml.SequenceNode {
			for _, v := range n.Content {
				if e := walk(v, key); e != nil {
					return e
				}
			}
			return nil
		}
		if key == "type" && strings.EqualFold(n.Value, "llm") {
			return errors.New("model-provider matcher is outside this workflow")
		}
		if e := validateExpressions(n.Value, key == "dsl" || key == "expression"); e != nil {
			return e
		}
		lower := strings.ToLower(n.Value)
		for _, bad := range []string{"interactsh"} {
			if strings.Contains(lower, bad) {
				return errors.New("restricted external reference")
			}
		}
		if key == "path" {
			prefix := ""
			for _, v := range []string{"{{BaseURL}}", "{{RootURL}}"} {
				if strings.HasPrefix(n.Value, v) {
					prefix = v
				}
			}
			if prefix == "" {
				return errors.New("HTTP path must use BaseURL or RootURL")
			}
			suffix := strings.TrimPrefix(n.Value, prefix)
			if suffix != "" && !strings.HasPrefix(suffix, "/") && !strings.HasPrefix(suffix, "?") {
				return errors.New("HTTP path may not change target authority")
			}
		}
		if key == "raw" {
			lines := strings.Split(strings.ReplaceAll(n.Value, "\r\n", "\n"), "\n")
			if len(lines) < 2 {
				return errors.New("malformed raw HTTP")
			}
			first := strings.Fields(lines[0])
			if len(first) != 3 || !strings.HasPrefix(first[1], "/") {
				return errors.New("raw HTTP must use relative request target")
			}
			hostOK := false
			hostCount := 0
			hostLine := -1
			for i, line := range lines[1:] {
				line = strings.TrimSpace(line)
				if line == "" {
					break
				}
				if strings.HasPrefix(strings.ToLower(line), "host:") {
					hostCount++
					hostLine = i + 1
					hostOK = strings.TrimSpace(strings.SplitN(line, ":", 2)[1]) == "{{Hostname}}"
				}
			}
			if !hostOK || hostCount != 1 {
				return errors.New("raw HTTP requires exact Hostname host")
			}
			// Native annotations are parsed after rendering across the entire raw
			// request, including its body. Only the reserved target Hostname marker
			// is permitted; every other byte must remain literal after approval.
			for i, line := range lines {
				if strings.HasPrefix(strings.TrimSpace(line), "@") {
					return errors.New("raw HTTP annotations are outside this workflow")
				}
				literal := line
				if i == hostLine {
					literal = strings.Replace(literal, "{{Hostname}}", "", 1)
				}
				if strings.Contains(literal, "{{") || strings.Contains(literal, "}}") || strings.Contains(literal, "§") {
					return errors.New("raw HTTP must be literal except its exact target Hostname header")
				}
			}

		}
		if key == "payloads" && n.Kind == yaml.ScalarNode {
			if !safePath(n.Value) {
				return errors.New("unsafe payload dependency")
			}
			if _, ok := files[n.Value]; !ok {
				return fmt.Errorf("undeclared local dependency %q", n.Value)
			}
		}
		return nil
	}
	// Payload mapping values are either inline arrays or declared local data files.
	var payloadCheck func(*yaml.Node) error
	payloadCheck = func(n *yaml.Node) error {
		if n.Kind == yaml.MappingNode {
			for i := 0; i < len(n.Content); i += 2 {
				if n.Content[i].Value == "payloads" {
					p := n.Content[i+1]
					if p.Kind != yaml.MappingNode {
						return errors.New("invalid payloads")
					}
					for j := 1; j < len(p.Content); j += 2 {
						v := p.Content[j]
						if v.Kind == yaml.ScalarNode {
							if strings.Contains(v.Value, "\n") {
								continue
							}
							if !safePath(v.Value) {
								return errors.New("unsafe payload path")
							}
							if _, ok := files[v.Value]; !ok {
								return errors.New("undeclared payload dependency")
							}
						} else if v.Kind != yaml.SequenceNode {
							return errors.New("invalid payload values")
						}
					}
				}
				if e := payloadCheck(n.Content[i+1]); e != nil {
					return e
				}
			}
		} else {
			for _, v := range n.Content {
				if e := payloadCheck(v); e != nil {
					return e
				}
			}
		}
		return nil
	}
	if e := walk(r, ""); e != nil {
		return "", e
	}
	if e := payloadCheck(r); e != nil {
		return "", e
	}
	return id, nil
}
func prepare(ctx context.Context, o options) error {
	if o.output == "" || o.maxDownload < 1 || o.maxDownload > maxExpanded {
		return errors.New("output and explicit max-download-bytes (1..268435456) required")
	}
	if o.reuse != "" {
		if len(o.official)+len(o.custom)+len(o.data)+len(o.customData) > 0 {
			return errors.New("reuse cannot refresh or add files")
		}
		_, m, e := loadBundle(o.reuse, o.reuseHash, o.reuseLength)
		if e != nil {
			return fmt.Errorf("explicit previous bundle invalid: %w", e)
		}
		b, e := readRegular(o.reuse, maxArchive)
		if e != nil {
			return e
		}
		m.Outcome = "explicit-prior-bundle-reuse"
		m.SHA256 = o.reuseHash
		m.Bytes = o.reuseLength
		return publishPreparation(o.output, b, m)
	}
	if len(o.official)+len(o.custom) == 0 {
		return errors.New("select at least one HTTP template")
	}
	if len(o.official)+len(o.data)+len(o.custom)+len(o.customData) >= maxEntries {
		return errors.New("too many selected files")
	}
	for _, p := range append(append(stringsFlag{}, o.official...), o.data...) {
		if !safePath(p) {
			return errors.New("unsafe official path")
		}
	}
	files := map[string][]byte{}
	m := bundleManifest{Version: 1, Outcome: "refreshed"}
	remaining := int64(o.maxDownload)
	client := &http.Client{Timeout: time.Duration(o.timeout) * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Host != via[0].URL.Host || req.URL.Path != via[0].URL.Path || req.URL.RawQuery != "" {
			return errors.New("unapproved preparation redirect")
		}
		return nil
	}}
	fetch := func(u string) ([]byte, error) {
		req, e := http.NewRequestWithContext(ctx, "GET", u, nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("User-Agent", "aih-nuclei-helper")
		resp, e := client.Do(req)
		if e != nil {
			return nil, e
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("upstream HTTP %d", resp.StatusCode)
		}
		b, e := io.ReadAll(io.LimitReader(resp.Body, remaining+1))
		remaining -= int64(len(b))
		if remaining < 0 {
			return nil, errors.New("download byte limit exceeded")
		}
		return b, e
	}
	if len(o.official)+len(o.data) > 0 {
		b, e := fetch("https://api.github.com/repos/projectdiscovery/nuclei-templates/releases/latest")
		if e != nil {
			return fmt.Errorf("refresh failed; retry or explicitly reuse a validated bundle: %w", e)
		}
		var rel struct {
			Tag   string `json:"tag_name"`
			Draft bool   `json:"draft"`
			Pre   bool   `json:"prerelease"`
		}
		if e = json.Unmarshal(b, &rel); e != nil || rel.Draft || rel.Pre || !regexp.MustCompile(`^[A-Za-z0-9_.-]+$`).MatchString(rel.Tag) {
			return errors.New("invalid latest stable release")
		}
		m.Tag = rel.Tag
		b, e = fetch("https://api.github.com/repos/projectdiscovery/nuclei-templates/git/ref/tags/" + rel.Tag)
		if e != nil {
			return e
		}
		var ref struct {
			Object struct {
				SHA  string `json:"sha"`
				Type string `json:"type"`
			} `json:"object"`
		}
		if e = json.Unmarshal(b, &ref); e != nil {
			return e
		}
		for i := 0; ref.Object.Type == "tag" && i < 4; i++ {
			if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(ref.Object.SHA) {
				return errors.New("invalid tag hash")
			}
			b, e = fetch("https://api.github.com/repos/projectdiscovery/nuclei-templates/git/tags/" + ref.Object.SHA)
			if e != nil {
				return e
			}
			if e = json.Unmarshal(b, &ref); e != nil {
				return e
			}
		}
		if ref.Object.Type != "commit" || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(ref.Object.SHA) {
			return errors.New("tag does not resolve to commit")
		}
		m.Commit = ref.Object.SHA
		for _, p := range append(append(stringsFlag{}, o.official...), o.data...) {
			if pathCollision(files, p) {
				return errors.New("duplicate selected path")
			}
			b, e = fetch("https://raw.githubusercontent.com/projectdiscovery/nuclei-templates/" + m.Commit + "/" + p)
			if e != nil {
				return e
			}
			files[p] = b
		}
	}
	templates := map[string]bool{}
	for _, p := range o.official {
		templates[p] = true
	}
	for ci, c := range append(append(stringsFlag{}, o.custom...), o.customData...) {
		p := strings.SplitN(c, "=", 2)
		if len(p) != 2 || !safePath(p[1]) {
			return errors.New("custom must be SOURCE=RELATIVE")
		}
		if pathCollision(files, p[1]) {
			return errors.New("duplicate custom path")
		}
		b, e := readRegular(p[0], maxExpanded)
		if e != nil {
			return e
		}
		remaining -= int64(len(b))
		if remaining < 0 {
			return errors.New("snapshot byte limit exceeded")
		}
		files[p[1]] = b
		templates[p[1]] = ci < len(o.custom)
		m.Warnings = append(m.Warnings, "Explicit custom HTTP source; may be unsigned: "+p[1])
	}
	keys := make([]string, 0, len(files))
	for p := range files {
		keys = append(keys, p)
	}
	sort.Strings(keys)
	count := 0
	ids := map[string]bool{}
	for _, p := range keys {
		f := member{Path: p, SHA256: digest(files[p]), Bytes: len(files[p]), Template: templates[p]}
		if !f.Template {
			if e := validateExpressions(string(files[p]), false); e != nil {
				return e
			}
		}
		if f.Template {
			count++
			id, e := validateTemplate(files[p], files)
			if e != nil {
				return fmt.Errorf("%s: %w", p, e)
			}
			if ids[id] {
				return errors.New("duplicate template id")
			}
			ids[id] = true
			f.ID = id
		}
		m.Files = append(m.Files, f)
	}
	if count == 0 {
		return errors.New("no HTTP templates selected")
	}
	raw, _ := json.Marshal(m)
	expanded := len(raw)
	for _, b := range files {
		expanded += len(b)
	}
	if expanded > maxExpanded {
		return errors.New("expanded snapshot bound exceeded")
	}
	files["bundle-manifest.json"] = raw
	keys = append(keys, "bundle-manifest.json")
	sort.Strings(keys)
	var buf bytes.Buffer
	z := gzip.NewWriter(&buf)
	tw := tar.NewWriter(z)
	for _, p := range keys {
		b := files[p]
		if e := tw.WriteHeader(&tar.Header{Name: p, Mode: 0600, Size: int64(len(b)), Typeflag: tar.TypeReg}); e != nil {
			return e
		}
		if _, e := tw.Write(b); e != nil {
			return e
		}
	}
	if e := tw.Close(); e != nil {
		return e
	}
	if e := z.Close(); e != nil {
		return e
	}
	if buf.Len() > maxArchive {
		return errors.New("compressed archive bound exceeded")
	}
	m.SHA256 = digest(buf.Bytes())
	m.Bytes = int64(buf.Len())
	return publishPreparation(o.output, buf.Bytes(), m)
}
func publishPreparation(dir string, b []byte, m bundleManifest) error {
	abs, e := filepath.Abs(dir)
	if e != nil {
		return e
	}
	if _, e = safeRoot(filepath.Dir(abs)); e != nil {
		return e
	}
	if e = os.Mkdir(abs, 0700); e != nil {
		return errors.New("preparation output already exists or unavailable")
	}
	complete := false
	defer func() {
		if !complete {
			os.RemoveAll(abs)
		}
	}()
	if e = atomicBytes(filepath.Join(abs, "templates.tar.gz"), b); e != nil {
		return e
	}
	if e = atomicJSON(filepath.Join(abs, "preparation.json"), m); e != nil {
		return e
	}
	complete = true
	return nil
}
