package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

const validHTTP = "id: fixture-http\ninfo:\n  name: Controlled fixture\n  author: fixture\n  severity: info\nhttp:\n  - method: GET\n    path:\n      - '{{BaseURL}}/health'\n    matchers:\n      - type: status\n        status: [200]\n"

func snapshot(t *testing.T, template string) (string, bundleManifest) {
	t.Helper()
	d := t.TempDir()
	source := filepath.Join(d, "http.yaml")
	if e := os.WriteFile(source, []byte(template), 0600); e != nil {
		t.Fatal(e)
	}
	out := filepath.Join(d, "snapshot")
	args := append([]string{"prepare", "--output", out, "--custom", source + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
	if code, msg := invoke(t, args...); code != 0 {
		t.Fatalf("prepare=%d %s", code, msg)
	}
	var m bundleManifest
	b, e := os.ReadFile(filepath.Join(out, "preparation.json"))
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &m); e != nil {
		t.Fatal(e)
	}
	return filepath.Join(out, "templates.tar.gz"), m
}
func TestCustomSnapshotAndExplicitReuse(t *testing.T) {
	bundle, m := snapshot(t, validHTTP)
	if len(m.Warnings) != 1 || m.Bytes == 0 || m.Outcome != "refreshed" {
		t.Fatalf("manifest %+v", m)
	}
	out := filepath.Join(t.TempDir(), "reused")
	args := append([]string{"prepare", "--output", out, "--reuse-bundle", bundle, "--reuse-sha256", m.SHA256, "--reuse-bytes", fmtInt(m.Bytes), "--max-download-bytes", "65536"}, limits()...)
	if code, msg := invoke(t, args...); code != 0 {
		t.Fatalf("reuse=%d %s", code, msg)
	}
	if code, _ := invoke(t, args...); code != 10 {
		t.Fatal("reused output must collide")
	}
}
func TestPreparationRejectsExecutableAndRemoteCapabilities(t *testing.T) {
	for _, content := range []string{strings.Replace(validHTTP, "http:", "headless:", 1), validHTTP + "code:\n  - source: evil\n", strings.Replace(validHTTP, "{{BaseURL}}/health", "https://outside.invalid/", 1), strings.Replace(validHTTP, "{{BaseURL}}/health", "{{BaseURL}}/{{interactsh-url}}", 1), validHTTP + "http: []\n", validHTTP + "---\nid: second\n"} {
		t.Run(content, func(t *testing.T) {
			d := t.TempDir()
			p := filepath.Join(d, "bad.yaml")
			os.WriteFile(p, []byte(content), 0600)
			args := append([]string{"prepare", "--output", filepath.Join(d, "output"), "--custom", p + "=bad.yaml", "--max-download-bytes", "65536"}, limits()...)
			if code, msg := invoke(t, args...); code != 10 {
				t.Fatalf("code=%d %s", code, msg)
			}
			if _, e := os.Stat(filepath.Join(d, "output")); !os.IsNotExist(e) {
				t.Fatal("failed preparation published output")
			}
		})
	}
}
func TestArchiveTraversalFailsBeforeDocker(t *testing.T) {
	var b bytes.Buffer
	z := gzip.NewWriter(&b)
	tw := tar.NewWriter(z)
	tw.WriteHeader(&tar.Header{Name: "../escape", Size: 1, Mode: 0600})
	tw.Write([]byte("x"))
	tw.Close()
	z.Close()
	p := filepath.Join(t.TempDir(), "bad.tar.gz")
	os.WriteFile(p, b.Bytes(), 0600)
	args := runArguments(t, p, bundleManifest{SHA256: digest(b.Bytes()), Bytes: int64(b.Len())}, "success")
	if code, msg := invoke(t, args...); code != 10 || !strings.Contains(msg, "unsafe archive") {
		t.Fatalf("code=%d %s", code, msg)
	}
}
func fmtInt(n int64) string { return strconv.FormatInt(n, 10) }
func runArguments(t *testing.T, bundle string, m bundleManifest, mode string) []string {
	t.Helper()
	docker := fakeDocker(t, mode)
	args := []string{"run", "--run-dir", filepath.Join(filepath.Dir(docker), "run"), "--bundle", bundle, "--bundle-sha256", m.SHA256, "--bundle-bytes", fmtInt(m.Bytes), "--target", "https://fixture.invalid/", "--allow-host", "fixture.invalid", "--daemon", "unix:///var/run/docker.sock", "--docker-cli", docker, "--image", "projectdiscovery/nuclei@sha256:" + strings.Repeat("a", 64), "--container", "aih-nuclei-fixture-c", "--network", "aih-nuclei-fixture-n", "--target-mode", "public", "--container-user", fmt.Sprintf("%d:%d", os.Geteuid(), os.Getegid()), "--host-gateway=false", "--cpus", "1", "--memory-mib", "128", "--pids", "32", "--rate-limit", "2", "--tool-timeout-seconds", "10", "--cleanup-timeout-seconds", "3", "--max-report-bytes", "65536"}
	return append(args, limits()...)
}
func argValue(args []string, k string) string {
	for i, v := range args {
		if v == k && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}
func TestControlledRunEmptyFindingsAndIndependentValidation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture CLI uses POSIX executable; Windows runtime evidence requires Windows fixture")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "success")
	t.Setenv("DOCKER_CONTEXT", "secret-context")
	t.Setenv("HTTPS_PROXY", "http://secret-proxy.invalid")
	t.Setenv("NUCLEI_SECRET", "secret")
	if code, msg := invoke(t, args...); code != 0 {
		t.Fatalf("run=%d %s", code, msg)
	}
	dir := argValue(args, "--run-dir")
	v := append([]string{"validate", "--run-dir", dir}, limits()...)
	if code, msg := invoke(t, v...); code != 0 {
		t.Fatalf("validate=%d %s", code, msg)
	}
	if code, _ := invoke(t, args...); code != 10 {
		t.Fatal("run directory reuse accepted")
	}
	os.WriteFile(filepath.Join(dir, "reports", "findings.jsonl"), []byte("{}\n"), 0600)
	if code, _ := invoke(t, v...); code != 12 {
		t.Fatal("changed reports accepted")
	}
}
func TestControlledRunHonestFailures(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	for _, mode := range []string{"missing", "tool-failure", "cleanup-failure", "wrong-evidence", "foreign-label"} {
		t.Run(mode, func(t *testing.T) {
			bundle, m := snapshot(t, validHTTP)
			args := runArguments(t, bundle, m, mode)
			code, msg := invoke(t, args...)
			want := 12
			if mode == "tool-failure" {
				want = 11
			}
			if mode == "cleanup-failure" || mode == "foreign-label" {
				want = 13
			}
			if code != want {
				t.Fatalf("code=%d want=%d %s", code, want, msg)
			}
			dir := argValue(args, "--run-dir")
			v := append([]string{"validate", "--run-dir", dir}, limits()...)
			if code, _ := invoke(t, v...); code != 12 {
				t.Fatal("failed run validates")
			}
			if _, e := os.Stat(filepath.Join(dir, "index.md")); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestReconcilePreservesReportsAndDoesNotRepair(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "tool-failure")
	if c, _ := invoke(t, args...); c != 11 {
		t.Fatal(c)
	}
	dir := argValue(args, "--run-dir")
	r := []string{"reconcile", "--run-dir", dir, "--daemon", argValue(args, "--daemon"), "--docker-cli", argValue(args, "--docker-cli"), "--container", argValue(args, "--container"), "--network", argValue(args, "--network"), "--cleanup-timeout-seconds", "3"}
	r = append(r, limits()...)
	if c, msg := invoke(t, r...); c != 0 {
		t.Fatalf("reconcile %d %s", c, msg)
	}
	if _, e := os.Stat(filepath.Join(dir, "reports", "stdout.log")); e != nil {
		t.Fatal(e)
	}
	v := append([]string{"validate", "--run-dir", dir}, limits()...)
	if c, _ := invoke(t, v...); c != 12 {
		t.Fatal("reconcile repaired failure")
	}
}
func TestTargetRejectionPrecedesDocker(t *testing.T) {
	bundle, m := snapshot(t, validHTTP)
	for _, target := range []string{"-https://fixture.invalid", "https://user:password@fixture.invalid/", "https://other.invalid/", "file:///etc/passwd", "https://fixture.invalid/\n--evil"} {
		args := runArguments(t, bundle, m, "success")
		for i, v := range args {
			if v == "--target" {
				args[i+1] = target
			}
		}
		if c, _ := invoke(t, args...); c != 10 {
			t.Fatal(target, c)
		}
	}
}
func fakeDocker(t *testing.T, mode string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "docker-fixture")
	script := `#!/usr/bin/python3
import sys,os,json,pathlib,time
root=pathlib.Path(__file__).parent
mode=MODE
assert not any(k in os.environ for k in ['DOCKER_CONTEXT','DOCKER_HOST','DOCKER_CONFIG','HTTPS_PROXY','NUCLEI_SECRET'])
a=sys.argv[1:]
assert a[0]=='--host' and a[1]=='unix:///var/run/docker.sock' and a[2]=='--config'
assert pathlib.Path(a[3]).is_dir() and not list(pathlib.Path(a[3]).glob('config.json'))
a=a[4:]
def load(k):
 p=root/k
 return json.loads(p.read_text()) if p.exists() else None
def save(k,v): (root/k).write_text(json.dumps(v))
def value(flag): return a[a.index(flag)+1]
if a[0]=='info':
 if mode=='delayed-preflight': time.sleep(10)
 print('linux')
elif a[:2]==['image','inspect']: print(json.dumps([{'RepoDigests':[a[2]]}]))
elif a[1]=='ls':
 k=a[0];v=load(k)
 if v: print(v['name'])
elif a[:2]==['network','create']:
 labels=dict(a[i+1].split('=',1) for i,v in enumerate(a) if v=='--label')
 save('network',{'name':a[-1],'labels':labels})
 if mode=='delayed-resource': time.sleep(10)
 print('network-id')
elif a[:2]==['container','create']:
 labels=dict(a[i+1].split('=',1) for i,v in enumerate(a) if v=='--label')
 assert '--read-only' in a and value('--cap-drop')=='ALL'
 assert value('--user')==str(os.geteuid())+':'+str(os.getegid())
 assert '-duc' in a and '-ni' in a and '-lna' in a
 mounts=[a[i+1] for i,v in enumerate(a) if v=='--mount']
 report=[x for x in mounts if 'dst=/reports' in x][0].split('src=')[1].split(',')[0]
 save('container',{'name':value('--name'),'labels':labels,'report':report,'target':value('-u'),'template':value('-t')});print('container-id')
elif a[:2]==['container','start']:
 v=load('container');r=pathlib.Path(v['report'])
 if mode=='tool-failure': sys.exit(7)
 if mode!='missing': (r/'findings.jsonl').write_text('')
 if mode=='nonempty-no-sarif': (r/'findings.jsonl').write_text('{"template-id":"fixture-http"}\n')
 if mode not in ['empty-no-sarif','nonempty-no-sarif']: (r/'results.sarif').write_text(json.dumps({'version':'2.1.0','runs':[{'tool':{'driver':{'name':'nuclei'}},'results':[]}]}))
 if mode=='null-sarif-tool': (r/'results.sarif').write_text('{"version":"2.1.0","runs":[{"tool":null,"results":[]}]}')
 (r/'markdown').mkdir();(r/'markdown'/'index.md').write_text('| Host | Finding | Severity |\n')
 target=v['target'] if mode!='wrong-evidence' else 'https://outside.invalid/'
 (r/'trace.jsonl').write_text(json.dumps({'template':v['template'],'input':target,'type':'http','error':('failed connection' if mode=='trace-failure' else ('' if mode=='trace-empty' else 'none'))}))
 (r/'errors.jsonl').write_text('')
elif a[1]=='inspect':
 v=load(a[0]);labels=v['labels'].copy()
 if mode=='foreign-label': labels['io.aihq.nuclei.owner']='foreign'
 row={'Id':'controlled-id','Labels':labels,'Config':{'Labels':labels},'State':{'Running':False,'ExitCode':0,'OOMKilled':False}}
 print(json.dumps([row]))
elif a[1]=='stop': pass
elif a[1]=='rm':
 if mode=='cleanup-failure': sys.exit(1)
 (root/a[0]).unlink(missing_ok=True)
else: raise Exception(a)
`
	script = strings.Replace(script, "MODE", strconv.Quote(mode), 1)
	if e := os.WriteFile(p, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	return p
}

func TestPreparationSnapshotsDeclaredCustomData(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "http.yaml")
	data := filepath.Join(d, "words.yaml")
	template := strings.Replace(validHTTP, "    matchers:", "    payloads:\n      word: data/words.yaml\n    matchers:", 1)
	os.WriteFile(p, []byte(template), 0600)
	os.WriteFile(data, []byte("one\ntwo\n"), 0600)
	args := append([]string{"prepare", "--output", filepath.Join(d, "snapshot"), "--custom", p + "=http.yaml", "--custom-data", data + "=data/words.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 0 {
		t.Fatalf("declared custom data: code=%d %s", c, msg)
	}
}

type controlledTransport func(*http.Request) (*http.Response, error)

func (f controlledTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestOfficialPreparationUsesOnlyResolvedSelectedCommit(t *testing.T) {
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	commit := strings.Repeat("b", 40)
	seen := []string{}
	http.DefaultTransport = controlledTransport(func(r *http.Request) (*http.Response, error) {
		seen = append(seen, r.URL.String())
		body := ""
		switch r.URL.String() {
		case "https://api.github.com/repos/projectdiscovery/nuclei-templates/releases/latest":
			body = `{"tag_name":"v1.2.3","draft":false,"prerelease":false}`
		case "https://api.github.com/repos/projectdiscovery/nuclei-templates/git/ref/tags/v1.2.3":
			body = `{"object":{"type":"tag","sha":"` + strings.Repeat("a", 40) + `"}}`
		case "https://api.github.com/repos/projectdiscovery/nuclei-templates/git/tags/" + strings.Repeat("a", 40):
			body = `{"object":{"type":"commit","sha":"` + commit + `"}}`
		case "https://raw.githubusercontent.com/projectdiscovery/nuclei-templates/" + commit + "/http/fixture.yaml":
			body = validHTTP
		default:
			t.Fatalf("unexpected fetch %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	out := filepath.Join(t.TempDir(), "snapshot")
	args := append([]string{"prepare", "--output", out, "--official", "http/fixture.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 0 || !strings.Contains(msg, "v1.2.3") || !strings.Contains(msg, commit) {
		t.Fatalf("prepare %d %s", c, msg)
	}
	if len(seen) != 4 {
		t.Fatalf("fetches %v", seen)
	}
}
func TestOfficialRefreshFailureHasNoImplicitFallback(t *testing.T) {
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	http.DefaultTransport = controlledTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader("rate limited")), Header: make(http.Header)}, nil
	})
	out := filepath.Join(t.TempDir(), "snapshot")
	args := append([]string{"prepare", "--output", out, "--official", "http/fixture.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 10 || !strings.Contains(msg, "retry or explicitly reuse") || !strings.Contains(msg, "429") {
		t.Fatalf("prepare %d %s", c, msg)
	}
	if _, e := os.Stat(out); !os.IsNotExist(e) {
		t.Fatal("failed refresh published a snapshot")
	}
}

func TestNativeSARIFOmissionOnlyForVerifiedEmptyExecution(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	for _, mode := range []string{"empty-no-sarif", "nonempty-no-sarif"} {
		t.Run(mode, func(t *testing.T) {
			bundle, m := snapshot(t, validHTTP)
			args := runArguments(t, bundle, m, mode)
			code, msg := invoke(t, args...)
			want := 0
			if mode == "nonempty-no-sarif" {
				want = 12
			}
			if code != want {
				t.Fatalf("code=%d want=%d %s", code, want, msg)
			}
			dir := argValue(args, "--run-dir")
			b, e := os.ReadFile(filepath.Join(dir, "manifest.json"))
			if e != nil {
				t.Fatal(e)
			}
			var result map[string]any
			json.Unmarshal(b, &result)
			if mode == "empty-no-sarif" {
				if result["nativeSARIFOmitted"] != true {
					t.Fatal("native omission not recorded")
				}
				v := append([]string{"validate", "--run-dir", dir}, limits()...)
				if c, msg := invoke(t, v...); c != 0 {
					t.Fatalf("validate %d %s", c, msg)
				}
				if _, e = os.Stat(filepath.Join(dir, "reports", "results.sarif")); !os.IsNotExist(e) {
					t.Fatal("helper fabricated native SARIF")
				}
			}
		})
	}
}

func TestCustomHTTPRefusesModelProviderMatcher(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "llm.yaml")
	os.WriteFile(p, []byte(strings.Replace(validHTTP, "type: status", "type: llm", 1)), 0600)
	args := append([]string{"prepare", "--output", filepath.Join(d, "snapshot"), "--custom", p + "=llm.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 10 {
		t.Fatalf("model matcher code=%d %s", c, msg)
	}
}

func TestPreparationRefusesReservedTargetVariableShadowing(t *testing.T) {
	for _, name := range []string{"BaseURL", "RootURL", "Hostname", "Host", "Port", "Path", "Query", "File", "Scheme", "Input", "FQDN", "RDN", "DN", "TLD", "SD", "ip"} {
		for _, surface := range []string{"constants", "variables", "payloads", "extractors"} {
			t.Run(surface+"/"+name, func(t *testing.T) {
				content := validHTTP
				switch surface {
				case "constants", "variables":
					content += "\n" + surface + ":\n  " + name + ": https://outside.invalid\n"
				case "payloads":
					content = strings.Replace(content, "    matchers:", "    payloads:\n      "+name+": ['https://outside.invalid']\n    matchers:", 1)
				case "extractors":
					content = strings.Replace(content, "    matchers:", "    extractors:\n      - type: regex\n        name: "+name+"\n        internal: true\n        regex: ['https://outside.invalid']\n    matchers:", 1)
				}
				d := t.TempDir()
				p := filepath.Join(d, "http.yaml")
				os.WriteFile(p, []byte(content), 0600)
				args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
				if c, msg := invoke(t, args...); c != 10 {
					t.Fatalf("shadow accepted %d %s", c, msg)
				}
			})
		}
	}
}

func TestPreparationRefusesDuplicateTemplateIDs(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "http.yaml")
	os.WriteFile(p, []byte(validHTTP), 0600)
	args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=one.yaml", "--custom", p + "=two.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 10 {
		t.Fatalf("duplicate IDs accepted %d %s", c, msg)
	}
}
func TestNativeSARIFRefusesNullTool(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "null-sarif-tool")
	if c, msg := invoke(t, args...); c != 12 {
		t.Fatalf("null SARIF tool accepted %d %s", c, msg)
	}
}

func TestPreparationRefusesStructuredForeignHostAndPortablePathAliases(t *testing.T) {
	for _, tc := range []struct{ name, template, first, second string }{{"foreign Host", strings.Replace(validHTTP, "    matchers:", "    headers:\n      hOsT: outside.invalid\n    matchers:", 1), "http.yaml", ""}, {"case aliases", validHTTP, "Http.yaml", "http.yaml"}, {"trailing dot", validHTTP, "http.yaml.", ""}, {"trailing space", validHTTP, "http.yaml ", ""}, {"DOS device", validHTTP, "NUL.yaml", ""}} {
		t.Run(tc.name, func(t *testing.T) {
			d := t.TempDir()
			p := filepath.Join(d, "source.yaml")
			os.WriteFile(p, []byte(tc.template), 0600)
			args := []string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=" + tc.first, "--max-download-bytes", "65536"}
			if tc.second != "" {
				other := filepath.Join(d, "other.yaml")
				os.WriteFile(other, []byte(strings.Replace(validHTTP, "fixture-http", "second-http", 1)), 0600)
				args = append(args, "--custom", other+"="+tc.second)
			}
			args = append(args, limits()...)
			if c, msg := invoke(t, args...); c != 10 {
				t.Fatalf("unsafe target/path accepted %d %s", c, msg)
			}
		})
	}
}

func TestSupportedCustomHTTPVariablesPayloadsExtractorsAndHost(t *testing.T) {
	content := validHTTP + "\nvariables:\n  custom_token: fixture\nconstants:\n  custom_header: fixture\n"
	content = strings.Replace(content, "    matchers:", "    headers:\n      Host: '{{Hostname}}'\n      X-Fixture: '{{custom_header}}'\n    payloads:\n      custom_word: ['one', 'two']\n    extractors:\n      - type: regex\n        name: custom_extracted\n        internal: true\n        regex: ['fixture']\n    matchers:", 1)
	snapshot(t, content)
}
func replaceArg(args []string, name, value string) {
	for i, v := range args {
		if v == name {
			args[i+1] = value
			return
		}
	}
}
func TestContainerUserMismatchRejectedBeforeResourceCreation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix owner check")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "success")
	replaceArg(args, "--container-user", "4294967294:4294967294")
	if c, msg := invoke(t, args...); c != 10 || !strings.Contains(msg, "UID:GID") {
		t.Fatalf("mismatch %d %s", c, msg)
	}
	if _, e := os.Stat(argValue(args, "--run-dir")); !os.IsNotExist(e) {
		t.Fatal("mismatched identity reserved output")
	}
}
func TestDelayedPreflightPreservesAbsoluteCleanupReserve(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	for _, mode := range []string{"delayed-preflight", "delayed-resource"} {
		t.Run(mode, func(t *testing.T) {
			bundle, m := snapshot(t, validHTTP)
			args := runArguments(t, bundle, m, mode)
			replaceArg(args, "--timeout-seconds", "6")
			replaceArg(args, "--cleanup-timeout-seconds", "2")
			replaceArg(args, "--tool-timeout-seconds", "1")
			start := time.Now()
			c, msg := invoke(t, args...)
			elapsed := time.Since(start)
			if c == 0 || elapsed >= 6*time.Second {
				t.Fatalf("deadline code=%d elapsed=%s %s", c, elapsed, msg)
			}
			dir := argValue(args, "--run-dir")
			var result runManifest
			b, e := os.ReadFile(filepath.Join(dir, "manifest.json"))
			if e != nil {
				t.Fatal(e)
			}
			json.Unmarshal(b, &result)
			if result.Status != "incomplete" {
				t.Fatal("deadline reported complete")
			}
			root := filepath.Dir(argValue(args, "--docker-cli"))
			if !result.CleanupConfirmed && c != 13 {
				t.Fatal("cleanup uncertainty not explicit")
			}
			if result.CleanupConfirmed {
				for _, resource := range []string{"container", "network"} {
					if _, e := os.Stat(filepath.Join(root, resource)); !os.IsNotExist(e) {
						t.Fatal("resource remains despite confirmed cleanup")
					}
				}
			}
		})
	}
}
func TestReconcileRequiresExplicitNestedCleanupBudget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI fixture")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "tool-failure")
	invoke(t, args...)
	r := append([]string{"reconcile", "--run-dir", argValue(args, "--run-dir"), "--daemon", argValue(args, "--daemon"), "--docker-cli", argValue(args, "--docker-cli"), "--container", argValue(args, "--container"), "--network", argValue(args, "--network")}, limits()...)
	if c, _ := invoke(t, r...); c != 13 {
		t.Fatal("missing cleanup budget accepted", c)
	}
}

func TestPreparationRefusesExternalDSLCallsAcrossExpressionsAndData(t *testing.T) {
	calls := []string{" resolve ('outside.invalid','a')", "PUBLIC_IP ()", "jarm\u2003('outside.invalid:443')", "publicip()", "jarm ('outside.invalid:443')", "LLM_PROMPT ('question')", "llmprompt('question')"}
	for _, call := range calls {
		for _, surface := range []string{"variable", "matcher", "extractor", "raw", "data", "payload"} {
			t.Run(surface+"/"+call, func(t *testing.T) {
				content := validHTTP
				switch surface {
				case "variable":
					content += "\nvariables:\n  custom: \"{{" + call + "}}\"\n"
				case "matcher":
					content = strings.Replace(content, "    matchers:", "    matchers:\n      - type: dsl\n        dsl:\n          - \""+call+"\"", 1)
				case "extractor":
					content = strings.Replace(content, "    matchers:", "    extractors:\n      - type: dsl\n        dsl:\n          - \""+call+"\"\n    matchers:", 1)
				case "raw":
					content = "id: fixture-http\ninfo: {name: fixture, author: fixture, severity: info}\nhttp:\n  - raw:\n      - |\n        POST / HTTP/1.1\n        Host: {{Hostname}}\n\n        {{" + call + "}}\n"
				case "data", "payload":
					content = strings.Replace(content, "    matchers:", "    payloads:\n      custom: "+map[bool]string{true: "data.txt", false: "[\"{{" + call + "}}\"]"}[surface == "data"]+"\n    matchers:", 1)
				}
				d := t.TempDir()
				p := filepath.Join(d, "http.yaml")
				os.WriteFile(p, []byte(content), 0600)
				args := []string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}
				if surface == "data" {
					data := filepath.Join(d, "data.txt")
					os.WriteFile(data, []byte("prefix '{{"+call+"}}' suffix\n"), 0600)
					args = append(args, "--custom-data", data+"=data.txt")
				}
				args = append(args, limits()...)
				if c, msg := invoke(t, args...); c != 10 {
					t.Fatalf("external DSL accepted %d %s", c, msg)
				}
			})
		}
	}
}
func TestNativeSuccessfulTraceUsesNoneSentinel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI")
	}
	bundle, m := snapshot(t, validHTTP)
	args := runArguments(t, bundle, m, "native-none")
	if c, msg := invoke(t, args...); c != 0 {
		t.Fatalf("native success rejected %d %s", c, msg)
	}
}

func TestRootVariablesRefuseEncodedRepeatedEvaluation(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("{{jarm('outside.invalid:443')}}"))
	content := validHTTP + "\nvariables:\n  hidden: '{{base64_decode(\"" + encoded + "\")}}'\n"
	d := t.TempDir()
	p := filepath.Join(d, "http.yaml")
	os.WriteFile(p, []byte(content), 0600)
	args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 10 {
		t.Fatalf("re-evaluated variable accepted %d %s", c, msg)
	}
}
func TestPureDirectHTTPAndMatcherHelpersRemainSupported(t *testing.T) {
	content := strings.Replace(validHTTP, "    matchers:", "    headers:\n      X-Fixture: '{{base64(\"fixture\")}}'\n      X-Nonce: '{{rand_base(8)}}'\n    matchers:\n      - type: dsl\n        dsl:\n          - \"contains(body, 'publicip()') && len(body) > 0\"", 1)
	snapshot(t, content)
}
func TestTraceRequiresNativeSuccessSentinel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX controlled CLI")
	}
	for _, mode := range []string{"trace-failure", "trace-empty"} {
		t.Run(mode, func(t *testing.T) {
			bundle, m := snapshot(t, validHTTP)
			if c, msg := invoke(t, runArguments(t, bundle, m, mode)...); c != 12 {
				t.Fatalf("failed/missing native success accepted %d %s", c, msg)
			}
		})
	}
}

func TestPreparationRefusesYAMLScalarEncodingOfExpressions(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("{{publicip()}}"))
	for _, surface := range []string{"body", "variable"} {
		t.Run(surface, func(t *testing.T) {
			content := validHTTP
			if surface == "body" {
				content = strings.Replace(content, "    matchers:", "    body: !!binary "+encoded+"\n    matchers:", 1)
			} else {
				content += "\nvariables:\n  hidden: !!binary " + encoded + "\n"
			}
			d := t.TempDir()
			p := filepath.Join(d, "http.yaml")
			os.WriteFile(p, []byte(content), 0600)
			args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
			if c, msg := invoke(t, args...); c != 10 {
				t.Fatalf("encoded YAML scalar accepted %d %s", c, msg)
			}
		})
	}
}

func TestPreparationRefusesEscapedFunctionIdentifiers(t *testing.T) {
	for _, call := range []string{`pub\licip()`, `ja\rm ("outside.invalid:443")`, `re\solve("outside.invalid","a")`} {
		t.Run(call, func(t *testing.T) {
			content := strings.Replace(validHTTP, "    matchers:", "    headers:\n      X-Fixture: '{{"+call+"}}'\n    matchers:", 1)
			d := t.TempDir()
			p := filepath.Join(d, "http.yaml")
			os.WriteFile(p, []byte(content), 0600)
			args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
			if c, msg := invoke(t, args...); c != 10 {
				t.Fatalf("escaped function accepted %d %s", c, msg)
			}
		})
	}
}
func TestPureDSLQuotedRegexEscapesRemainSupported(t *testing.T) {
	content := strings.Replace(validHTTP, "    matchers:", "    matchers:\n      - type: dsl\n        dsl:\n          - 'regex(\"fixture\\\\d+\", body)'", 1)
	snapshot(t, content)
}

func literalRaw(body string) string {
	return "id: fixture-http\ninfo: {name: fixture, author: fixture, severity: info}\nhttp:\n  - raw:\n      - |\n        POST /health HTTP/1.1\n        Host: {{Hostname}}\n        Content-Type: text/plain\n\n" + body + "\n"
}
func TestRawRequestsRefuseAnnotationsAndComputedContent(t *testing.T) {
	cases := []string{"        @Host: outside.invalid:443", "        \t@tls-sni: outside.invalid", "        {{base64_decode('QEhvc3Q6IG91dHNpZGUuaW52YWxpZDo0NDM=')}}", "        {{custom_data}}", "        §custom_data§"}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			content := literalRaw(body) + "\nvariables:\n  custom_data: '@Host: outside.invalid:443'\n"
			d := t.TempDir()
			p := filepath.Join(d, "http.yaml")
			os.WriteFile(p, []byte(content), 0600)
			args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
			if c, msg := invoke(t, args...); c != 10 {
				t.Fatalf("computed/annotated raw accepted %d %s", c, msg)
			}
		})
	}
}
func TestLiteralRawRequestWithTargetHostRemainsSupported(t *testing.T) {
	snapshot(t, literalRaw("        literal fixture request body"))
}

func TestHTTPRefusesFuzzingAndUnsupportedRoutingCapabilities(t *testing.T) {
	for _, field := range []string{"fuzzing:\n      - part: path\n        type: replace\n        mode: single\n        fuzz: ['https://outside.invalid/']", "analyzer:\n      name: time_delay", "future-target-routing: https://outside.invalid/", "signature: AWS", "race: true", "race_count: 2", "pipeline: true", "pipeline-concurrent-connections: 2", "pipeline-requests-per-connection: 2"} {
		t.Run(field, func(t *testing.T) {
			content := strings.Replace(validHTTP, "    matchers:", "    "+field+"\n    matchers:", 1)
			d := t.TempDir()
			p := filepath.Join(d, "http.yaml")
			os.WriteFile(p, []byte(content), 0600)
			args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
			if c, msg := invoke(t, args...); c != 10 {
				t.Fatalf("unsupported HTTP capability accepted %d %s", c, msg)
			}
		})
	}
}

func TestRawHostHeaderNormalizationMatchesNativeParser(t *testing.T) {
	content := strings.Replace(literalRaw("        literal body"), "        Content-Type: text/plain", "          Host: outside.invalid\n        Content-Type: text/plain", 1)
	d := t.TempDir()
	p := filepath.Join(d, "http.yaml")
	os.WriteFile(p, []byte(content), 0600)
	args := append([]string{"prepare", "--output", filepath.Join(d, "out"), "--custom", p + "=http.yaml", "--max-download-bytes", "65536"}, limits()...)
	if c, msg := invoke(t, args...); c != 10 {
		t.Fatalf("native duplicate Host accepted %d %s", c, msg)
	}
}
