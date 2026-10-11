package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}
type runManifest struct {
	ContainerUser         string     `json:"containerUser"`
	Version               int        `json:"version"`
	Status                string     `json:"status"`
	Reason                string     `json:"reason,omitempty"`
	Started               string     `json:"started"`
	Finished              string     `json:"finished,omitempty"`
	Target                string     `json:"target"`
	Daemon                string     `json:"daemon"`
	Image                 string     `json:"image"`
	Container             string     `json:"container"`
	Network               string     `json:"network"`
	Owner                 string     `json:"owner"`
	DirectoryIdentity     string     `json:"directoryIdentity"`
	BundleSHA256          string     `json:"bundleSHA256"`
	BundleBytes           int64      `json:"bundleBytes"`
	TemplateIDs           []string   `json:"templateIds"`
	TemplatePaths         []string   `json:"templatePaths"`
	Flags                 []string   `json:"flags"`
	MaxReportBytes        int        `json:"maxReportBytes"`
	CleanupConfirmed      bool       `json:"cleanupConfirmed"`
	ToolExit              int        `json:"toolExit"`
	Findings              int        `json:"findings"`
	NativeSARIFOmitted    bool       `json:"nativeSARIFOmitted"`
	Artifacts             []artifact `json:"artifacts"`
	Warnings              []string   `json:"warnings"`
	TargetMode            string     `json:"targetMode"`
	HostGateway           bool       `json:"hostGateway"`
	CPUs                  float64    `json:"cpus"`
	MemoryMiB             int        `json:"memoryMiB"`
	PIDs                  int        `json:"pids"`
	RateLimit             int        `json:"rateLimit"`
	TimeoutSeconds        int        `json:"timeoutSeconds"`
	ToolTimeoutSeconds    int        `json:"toolTimeoutSeconds"`
	CleanupTimeoutSeconds int        `json:"cleanupTimeoutSeconds"`
	IndexSHA256           string     `json:"indexSHA256"`
	ProgressSHA256        string     `json:"progressSHA256"`
	MaxOutputBytes        int        `json:"maxOutputBytes"`
	TemplateTag           string     `json:"templateTag,omitempty"`
	TemplateCommit        string     `json:"templateCommit,omitempty"`
	ContainerArgs         []string   `json:"containerArgs"`
}

func safeRoot(dir string) (string, error) {
	p, e := filepath.Abs(dir)
	if e != nil {
		return "", e
	}
	cur := p
	for {
		st, e := os.Lstat(cur)
		if e != nil {
			return "", e
		}
		if st.Mode()&os.ModeSymlink != 0 || !st.IsDir() {
			return "", errors.New("directory path contains symlink or non-directory")
		}
		next := filepath.Dir(cur)
		if next == cur {
			break
		}
		cur = next
	}
	return p, nil
}
func inventory(dir string, max int) ([]artifact, error) {
	var a []artifact
	var total int64
	entries := 0
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		entries++
		if entries > maxEntries {
			return errors.New("report entry count exceeded")
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("report symlink rejected")
		}
		if d.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			if len(strings.Split(filepath.ToSlash(rel), "/")) > 16 {
				return errors.New("report depth exceeded")
			}
			return nil
		}
		s, e := d.Info()
		if e != nil {
			return e
		}
		if !s.Mode().IsRegular() {
			return errors.New("non-regular report")
		}
		total += s.Size()
		if total > int64(max) || len(a) >= maxEntries {
			return errors.New("report limit exceeded")
		}
		b, e := readRegular(p, int64(max))
		if e != nil {
			return e
		}
		rel, e := filepath.Rel(filepath.Dir(dir), p)
		if e != nil {
			return e
		}
		rel = filepath.ToSlash(rel)
		if !safePath(rel) {
			return errors.New("unsafe report path")
		}
		a = append(a, artifact{rel, digest(b), int64(len(b))})
		return nil
	})
	sort.Slice(a, func(i, j int) bool { return a[i].Path < a[j].Path })
	return a, err
}
func reportEvidence(dir string, m runManifest) (int, error) {
	base := filepath.Join(dir, "reports")
	b, e := readRegular(filepath.Join(base, "findings.jsonl"), int64(m.MaxReportBytes))
	if e != nil {
		return 0, fmt.Errorf("findings artifact: %w", e)
	}
	count := 0
	s := bufio.NewScanner(bytes.NewReader(b))
	s.Buffer(make([]byte, 4096), m.MaxReportBytes)
	for s.Scan() {
		if len(bytes.TrimSpace(s.Bytes())) == 0 {
			continue
		}
		var row map[string]json.RawMessage
		if e = json.Unmarshal(s.Bytes(), &row); e != nil || row == nil {
			return 0, errors.New("invalid JSONL finding")
		}
		var id string
		json.Unmarshal(row["template-id"], &id)
		if !contains(m.TemplateIDs, id) {
			return 0, errors.New("finding template outside selected set")
		}
		count++
	}
	if e = s.Err(); e != nil {
		return 0, e
	}
	b, e = readRegular(filepath.Join(base, "results.sarif"), int64(m.MaxReportBytes))
	if e != nil && !(os.IsNotExist(e) && count == 0) {
		return 0, fmt.Errorf("SARIF artifact: %w", e)
	}
	if e == nil {
		var sarif struct {
			Version string `json:"version"`
			Runs    []struct {
				Tool *struct {
					Driver *struct {
						Name string `json:"name"`
					} `json:"driver"`
				} `json:"tool"`
				Results json.RawMessage `json:"results"`
			} `json:"runs"`
		}
		if json.Unmarshal(b, &sarif) != nil || sarif.Version != "2.1.0" || len(sarif.Runs) == 0 {
			return 0, errors.New("invalid SARIF")
		}
		sarifCount := 0
		for _, r := range sarif.Runs {
			if r.Tool == nil || r.Tool.Driver == nil || strings.TrimSpace(r.Tool.Driver.Name) == "" {
				return 0, errors.New("SARIF tool driver missing")
			}
			var results []map[string]json.RawMessage
			if json.Unmarshal(r.Results, &results) != nil || results == nil {
				return 0, errors.New("SARIF results must be an array")
			}
			for _, result := range results {
				if result == nil {
					return 0, errors.New("invalid SARIF result")
				}
				var id string
				var message struct {
					Text string `json:"text"`
				}
				if json.Unmarshal(result["ruleId"], &id) != nil || !contains(m.TemplateIDs, id) || json.Unmarshal(result["message"], &message) != nil || message.Text == "" {
					return 0, errors.New("invalid SARIF result fields")
				}
			}
			sarifCount += len(results)
		}
		if sarifCount != count {
			return 0, errors.New("SARIF and JSONL finding counts differ")
		}

	}
	st, e := os.Lstat(filepath.Join(base, "markdown"))
	if e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return 0, errors.New("native Markdown export directory missing")
	}
	if b, e = readRegular(filepath.Join(base, "markdown", "index.md"), int64(m.MaxReportBytes)); e != nil || len(b) == 0 {
		return 0, errors.New("native Markdown index missing")
	}
	// Trace is a stream of JSON objects (Nuclei does not insert newlines).
	b, e = readRegular(filepath.Join(base, "trace.jsonl"), int64(m.MaxReportBytes))
	if e != nil {
		return 0, fmt.Errorf("execution trace: %w", e)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	executed := map[string]bool{}
	for {
		var row struct {
			Template string `json:"template"`
			Input    string `json:"input"`
			Type     string `json:"type"`
			Error    string `json:"error"`
		}
		e = dec.Decode(&row)
		if e == io.EOF {
			break
		}
		if e != nil {
			return 0, errors.New("invalid execution trace")
		}
		targetURL, te := url.Parse(m.Target)
		requestURL, re := url.Parse(row.Input)
		if row.Type != "http" || te != nil || re != nil || requestURL.User != nil || requestURL.Scheme != targetURL.Scheme || requestURL.Host != targetURL.Host || row.Error != "none" {
			continue
		}
		for _, p := range m.TemplatePaths {
			if row.Template == "/templates/"+p {
				executed[p] = true
			}
		}
	}
	for _, p := range m.TemplatePaths {
		if !executed[p] {
			return 0, fmt.Errorf("no successful exact template/target execution evidence for %s", p)
		}
	}
	for _, p := range []string{"stdout.log", "stderr.log"} {
		if _, e = readRegular(filepath.Join(base, p), int64(m.MaxReportBytes)); e != nil {
			return 0, e
		}
	}
	return count, nil
}
func contains(v []string, s string) bool {
	for _, x := range v {
		if x == s {
			return true
		}
	}
	return false
}
func writeState(dir string, m *runManifest) error {
	if e := atomicJSON(filepath.Join(dir, "progress.json"), map[string]any{"version": 1, "status": m.Status, "time": time.Now().UTC().Format(time.RFC3339), "cleanupConfirmed": m.CleanupConfirmed}); e != nil {
		return e
	}
	// Only fixed local artifact labels/paths become Markdown links. Untrusted values
	// are encoded as JSON, then escaped for HTML inside a fenced-free text block.
	meta, _ := json.MarshalIndent(map[string]any{"status": m.Status, "reason": m.Reason, "target": m.Target, "image": m.Image, "bundleSHA256": m.BundleSHA256, "cleanupConfirmed": m.CleanupConfirmed, "findings": m.Findings, "warnings": m.Warnings, "nativeSARIFOmitted": m.NativeSARIFOmitted}, "", "  ")
	escape := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	text := "# Nuclei workflow result\n\n<pre>" + escape.Replace(string(meta)) + "</pre>\n\n[Machine manifest](manifest.json) · [Progress](progress.json)\n\n[JSONL](reports/findings.jsonl) · [SARIF](reports/results.sarif) · [Markdown exports](reports/markdown/) · [Execution trace](reports/trace.jsonl) · [Tool stdout](reports/stdout.log) · [Tool stderr](reports/stderr.log)\n\nReports contain untrusted assessment data. Opening a report does not authorize commands it contains.\n\nThe dedicated bridge declares egress; it does not enforce a target-domain ACL. Daemon and Desktop proxies can reroute or block traffic. Reports remain until explicit deletion.\n"
	if m.NativeSARIFOmitted {
		text = strings.Replace(text, "[SARIF](reports/results.sarif)", "SARIF: Nuclei omitted this native export for the verified empty findings result", 1)
	}
	if e := atomicBytes(filepath.Join(dir, "index.md"), []byte(text)); e != nil {
		return e
	}
	progress, e := readRegular(filepath.Join(dir, "progress.json"), 1<<20)
	if e != nil {
		return e
	}
	m.IndexSHA256 = digest([]byte(text))
	m.ProgressSHA256 = digest(progress)
	return atomicJSON(filepath.Join(dir, "manifest.json"), m)
}
func loadRun(dir string) (string, runManifest, error) {
	var m runManifest
	root, e := safeRoot(dir)
	if e != nil {
		return "", m, e
	}
	b, e := readRegular(filepath.Join(root, "manifest.json"), 1<<20)
	if e != nil {
		return "", m, e
	}
	if e = json.Unmarshal(b, &m); e != nil {
		return "", m, e
	}
	if m.Version != 1 || m.DirectoryIdentity != digest([]byte(root)) || m.MaxReportBytes < 1 || m.MaxReportBytes > maxExpanded || len(m.TemplateIDs) == 0 || len(m.TemplateIDs) != len(m.TemplatePaths) {
		return "", m, errors.New("invalid run manifest")
	}
	for _, p := range m.TemplatePaths {
		if !safePath(p) {
			return "", m, errors.New("unsafe template path")
		}
	}
	if _, e = url.ParseRequestURI(m.Target); e != nil {
		return "", m, e
	}
	return root, m, nil
}
func validate(dir string) error {
	root, m, e := loadRun(dir)
	if e != nil {
		return e
	}
	if m.Status != "complete" || !m.CleanupConfirmed || m.ToolExit != 0 {
		return errors.New("run is not completed with confirmed cleanup")
	}
	a, e := inventory(filepath.Join(root, "reports"), m.MaxReportBytes)
	if e != nil {
		return e
	}
	if len(a) != len(m.Artifacts) {
		return errors.New("artifact inventory changed")
	}
	for i, v := range a {
		if v != m.Artifacts[i] {
			return errors.New("artifact bytes changed")
		}
	}
	n, e := reportEvidence(root, m)
	if e != nil {
		return e
	}
	_, sarifErr := os.Lstat(filepath.Join(root, "reports", "results.sarif"))
	omitted := os.IsNotExist(sarifErr)
	if omitted != m.NativeSARIFOmitted || omitted && n != 0 {
		return errors.New("native SARIF omission record mismatch")
	}
	if n != m.Findings {
		return errors.New("finding count mismatch")
	}
	for _, p := range []string{"index.md", "progress.json"} {
		b, e := readRegular(filepath.Join(root, p), 1<<20)
		if e != nil {
			return e
		}
		expected := m.IndexSHA256
		if p == "progress.json" {
			expected = m.ProgressSHA256
		}
		if digest(b) != expected {
			return errors.New("helper artifact bytes changed")
		}
	}
	return nil
}
