package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const ownerLabel = "io.aihq.nuclei.owner"
const directoryLabel = "io.aihq.nuclei.directory"

var resourceName = regexp.MustCompile(`^aih-nuclei-[a-z0-9][a-z0-9_.-]{0,80}$`)

func validateTarget(o options) error {
	if strings.HasPrefix(o.target, "-") || hasControl(o.target) || strings.Contains(o.target, " ") {
		return errors.New("unsafe target")
	}
	u, e := url.Parse(o.target)
	if e != nil || u.User != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Fragment != "" {
		return errors.New("one unauthenticated HTTP(S) target required")
	}
	h := strings.ToLower(u.Hostname())
	ok := false
	for _, v := range o.hosts {
		if v == h {
			ok = true
		}
		if v == "" || hasControl(v) || strings.ContainsAny(v, "/*@") || strings.Contains(v, ":") && net.ParseIP(v) == nil {
			return errors.New("allow-host must be an exact lowercase hostname or IP")
		}
	}
	if !ok {
		return errors.New("target hostname not in reviewed exact allowlist")
	}
	if o.mode != "public" && o.mode != "private" && o.mode != "local-host" {
		return errors.New("explicit target-mode required")
	}
	ip := net.ParseIP(h)
	if ip != nil && ip.IsLoopback() || h == "localhost" {
		return errors.New("container loopback is not host routing; supply reviewed reachable URL")
	}
	if o.mode == "public" && (h == "host.docker.internal" || strings.HasSuffix(h, ".localhost") || ip != nil && (ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast())) {
		return errors.New("public mode rejects local target")
	}
	if o.mode == "local-host" && h != "host.docker.internal" {
		return errors.New("local-host mode requires explicit host.docker.internal URL")
	}
	if o.gateway && (runtime.GOOS != "linux" || o.mode != "local-host") {
		return errors.New("host-gateway is only supported for explicit Linux local-host routing")
	}
	if runtime.GOOS == "linux" && o.mode == "local-host" && !o.gateway {
		return errors.New("Linux local-host requires explicit --host-gateway")
	}
	return nil
}
func validateDocker(o options) error {
	if o.docker == "" || !filepath.IsAbs(o.docker) {
		return errors.New("absolute Docker CLI executable required")
	}
	s, e := os.Stat(o.docker)
	if e != nil || !s.Mode().IsRegular() {
		return errors.New("Docker CLI not available")
	}
	if runtime.GOOS == "windows" {
		if o.daemon != "npipe:////./pipe/docker_engine" {
			return errors.New("only local Docker named pipe supported")
		}
	} else {
		if !strings.HasPrefix(o.daemon, "unix:///") || strings.ContainsAny(o.daemon, "\x00\r\n\t?#") || strings.Contains(strings.TrimPrefix(o.daemon, "unix://"), "..") {
			return errors.New("only absolute local unix socket supported")
		}
	}
	if !resourceName.MatchString(o.container) || !resourceName.MatchString(o.network) || o.container == o.network {
		return errors.New("unique aih-nuclei- container and network names required")
	}
	return nil
}

type dockerClient struct {
	o      options
	config string
}

func cleanEnv() []string {
	v := []string{}
	for _, k := range []string{"PATH", "SystemRoot", "WINDIR", "SYSTEMDRIVE", "TEMP", "TMP"} {
		if x, ok := os.LookupEnv(k); ok {
			v = append(v, k+"="+x)
		}
	}
	return v
}
func (d dockerClient) command(ctx context.Context, args ...string) *exec.Cmd {
	a := append([]string{"--host", d.o.daemon, "--config", d.config}, args...)
	c := exec.CommandContext(ctx, d.o.docker, a...)
	c.Env = cleanEnv()
	configureProcess(c)
	return c
}

type boundedBuffer struct {
	b        bytes.Buffer
	max      int
	overflow bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if b.b.Len()+len(p) > b.max {
		b.overflow = true
		p = p[:max(0, b.max-b.b.Len())]
	}
	b.b.Write(p)
	return n, nil
}
func (d dockerClient) call(ctx context.Context, args ...string) ([]byte, error) {
	c := d.command(ctx, args...)
	b := &boundedBuffer{max: 1 << 20}
	c.Stdout = b
	c.Stderr = b
	e := c.Run()
	if b.overflow {
		return nil, errors.New("Docker command output exceeded bound")
	}
	if e != nil {
		return nil, fmt.Errorf("Docker %s failed", args[0])
	}
	return b.b.Bytes(), nil
}
func (d dockerClient) present(ctx context.Context, kind, name string) (bool, error) {
	args := []string{kind, "ls"}
	if kind == "container" {
		args = append(args, "--all")
	}
	args = append(args, "--filter", "name=^"+name+"$", "--format", "{{.Names}}")
	if kind == "network" {
		args[len(args)-1] = "{{.Name}}"
	}
	b, e := d.call(ctx, args...)
	if e != nil {
		return false, e
	}
	return strings.TrimSpace(string(b)) != "", nil
}

func (d dockerClient) owned(ctx context.Context, kind, name string, m runManifest) error {
	b, e := d.call(ctx, kind, "inspect", name)
	if e != nil {
		return e
	}
	var rows []struct {
		ID     string            `json:"Id"`
		Labels map[string]string `json:"Labels"`
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if json.Unmarshal(b, &rows) != nil || len(rows) != 1 || rows[0].ID == "" {
		return errors.New("invalid resource inspect")
	}
	labels := rows[0].Labels
	if kind == "container" {
		labels = rows[0].Config.Labels
	}
	if labels[ownerLabel] != m.Owner || labels[directoryLabel] != m.DirectoryIdentity {
		return errors.New("resource ownership mismatch")
	}
	return nil
}
func (d dockerClient) cleanup(ctx context.Context, m runManifest) error {
	present, e := d.present(ctx, "container", m.Container)
	if e != nil {
		return e
	}
	if present {
		if e = d.owned(ctx, "container", m.Container, m); e != nil {
			return e
		}
		_, _ = d.call(ctx, "container", "stop", "--time", "1", m.Container)
		if _, e = d.call(ctx, "container", "rm", "--force", m.Container); e != nil {
			return e
		}
	}
	if present, e = d.present(ctx, "container", m.Container); e != nil || present {
		return errors.New("container absence not confirmed")
	}
	present, e = d.present(ctx, "network", m.Network)
	if e != nil {
		return e
	}
	if present {
		if e = d.owned(ctx, "network", m.Network, m); e != nil {
			return e
		}
		if _, e = d.call(ctx, "network", "rm", m.Network); e != nil {
			return e
		}
	}
	if present, e = d.present(ctx, "network", m.Network); e != nil || present {
		return errors.New("network absence not confirmed")
	}
	return nil
}
func run(ctx context.Context, o options) (code int, err error) {
	code = preflight
	outerDeadline, ok := ctx.Deadline()
	if !ok {
		return code, errors.New("bounded invocation context required")
	}
	if e := validateTarget(o); e != nil {
		return code, e
	}
	if e := validateDocker(o); e != nil {
		return code, e
	}
	if !regexp.MustCompile(`^projectdiscovery/nuclei@sha256:[a-f0-9]{64}$`).MatchString(o.image) {
		return code, errors.New("official preinstalled digest-pinned image required")
	}
	if math.IsNaN(o.cpus) || math.IsInf(o.cpus, 0) || o.cpus <= 0 || o.cpus > 4 || o.memory < 64 || o.memory > 4096 || o.pids < 16 || o.pids > 512 || o.rate < 1 || o.rate > 50 || o.toolTimeout < 1 || o.cleanupTimeout < 2 || o.toolTimeout+o.cleanupTimeout+2 >= o.timeout || o.maxReport < 1024 || o.maxReport > maxExpanded {
		return code, errors.New("explicit modest resource, report and nested time bounds required")
	}
	if e := validateContainerUser(o.containerUser); e != nil {
		return code, e
	}
	workDeadline := outerDeadline.Add(-time.Duration(o.cleanupTimeout+1) * time.Second)
	if !time.Now().Before(workDeadline) {
		return code, errors.New("insufficient work budget after cleanup reserve")
	}
	ctx, workCancel := context.WithDeadline(ctx, workDeadline)
	defer workCancel()
	files, bm, e := loadBundle(o.bundle, o.hash, o.length)
	if e != nil {
		return code, e
	}
	if o.runDir == "" {
		return code, errors.New("absent run-dir required")
	}
	abs, e := filepath.Abs(o.runDir)
	if e != nil {
		return code, e
	}
	if _, e = safeRoot(filepath.Dir(abs)); e != nil {
		return code, e
	}
	if e = os.Mkdir(abs, 0700); e != nil {
		return code, errors.New("run-dir collision or unavailable parent")
	}
	token := make([]byte, 24)
	if _, e = rand.Read(token); e != nil {
		return code, e
	}
	m := runManifest{ContainerUser: o.containerUser, Version: 1, Status: "preflight", Started: time.Now().UTC().Format(time.RFC3339), Target: o.target, Daemon: o.daemon, Image: o.image, Container: o.container, Network: o.network, Owner: hex.EncodeToString(token), DirectoryIdentity: digest([]byte(abs)), BundleSHA256: o.hash, BundleBytes: o.length, MaxReportBytes: o.maxReport, ToolExit: -1, Warnings: bm.Warnings, TargetMode: o.mode, HostGateway: o.gateway, CPUs: o.cpus, MemoryMiB: o.memory, PIDs: o.pids, RateLimit: o.rate, TimeoutSeconds: o.timeout, ToolTimeoutSeconds: o.toolTimeout, CleanupTimeoutSeconds: o.cleanupTimeout, MaxOutputBytes: o.maxOutput, TemplateTag: bm.Tag, TemplateCommit: bm.Commit}
	for _, f := range bm.Files {
		if f.Template {
			m.TemplateIDs = append(m.TemplateIDs, f.ID)
			m.TemplatePaths = append(m.TemplatePaths, f.Path)
		}
	}
	stage := filepath.Join(abs, ".staging")
	reports := filepath.Join(abs, "reports")
	for _, p := range []string{stage, filepath.Join(stage, "client"), filepath.Join(stage, "templates"), reports} {
		if e = os.Mkdir(p, 0700); e != nil {
			return code, e
		}
	}
	d := dockerClient{o, filepath.Join(stage, "client")}
	ownedResources := false
	defer func() {
		m.Finished = time.Now().UTC().Format(time.RFC3339)
		if ownedResources {
			cleanupDeadline := minTime(outerDeadline.Add(-time.Second), time.Now().Add(time.Duration(o.cleanupTimeout)*time.Second))
			c, cancel := context.WithDeadline(context.Background(), cleanupDeadline)
			ce := d.cleanup(c, m)
			cancel()
			if ce != nil {
				code = cleanupUncertain
				err = ce
			} else {
				m.CleanupConfirmed = true
			}
		} else {
			m.CleanupConfirmed = true
		}
		if m.CleanupConfirmed {
			if ce := os.RemoveAll(stage); ce != nil {
				m.CleanupConfirmed = false
				code = cleanupUncertain
				err = errors.New("staging removal unconfirmed")
			}
		}
		if err == nil {
			m.Status = "complete"
		} else {
			m.Status = "incomplete"
			m.Reason = err.Error()
		}
		m.Artifacts, _ = inventory(reports, o.maxReport)
		if e := writeState(abs, &m); e != nil && err == nil {
			code = invalidArtifact
			err = e
		}
		if err == nil {
			if e := validate(abs); e != nil {
				code = invalidArtifact
				err = e
				m.Status = "incomplete"
				m.Reason = e.Error()
				_ = writeState(abs, &m)
			}
		}
	}()
	if e = writeState(abs, &m); e != nil {
		return invalidArtifact, e
	}
	for p, b := range files {
		dest := filepath.Join(stage, "templates", filepath.FromSlash(p))
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return code, e
		}
		f, ce := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if ce != nil {
			return code, ce
		}
		_, ce = f.Write(b)
		closeErr := f.Close()
		if ce != nil {
			return code, ce
		}
		if closeErr != nil {
			return code, closeErr
		}
	}
	// Exact image inspect cannot pull or install anything.
	osType, e := d.call(ctx, "info", "--format", "{{.OSType}}")
	if e != nil {
		return code, e
	}
	if strings.TrimSpace(string(osType)) != "linux" {
		return code, errors.New("Docker must run Linux containers")
	}
	b, e := d.call(ctx, "image", "inspect", o.image)
	if e != nil {
		return code, e
	}
	var images []struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if json.Unmarshal(b, &images) != nil || len(images) != 1 || !contains(images[0].RepoDigests, o.image) {
		return code, errors.New("preexisting pinned image digest not verified")
	}
	for _, r := range []struct{ kind, name string }{{"container", o.container}, {"network", o.network}} {
		yes, e := d.present(ctx, r.kind, r.name)
		if e != nil {
			return code, e
		}
		if yes {
			return code, errors.New("declared resource name collision")
		}
	}
	ownedResources = true
	if _, e = d.call(ctx, "network", "create", "--driver", "bridge", "--label", ownerLabel+"="+m.Owner, "--label", directoryLabel+"="+m.DirectoryIdentity, o.network); e != nil {
		return code, e
	}
	selectedPaths := []string{}
	for _, p := range m.TemplatePaths {
		selectedPaths = append(selectedPaths, "/templates/"+p)
	}
	flags := []string{"-u", o.target, "-t", strings.Join(selectedPaths, ","), "-duc", "-ni", "-dr", "-rl", strconv.Itoa(o.rate), "-max-time", strconv.Itoa(o.toolTimeout) + "s", "-no-stdin", "-jsonl", "-o", "/reports/findings.jsonl", "-se", "/reports/results.sarif", "-me", "/reports/markdown", "-tlog", "/reports/trace.jsonl", "-elog", "/reports/errors.jsonl", "-no-color"}
	if o.mode == "public" {
		flags = append(flags, "-lna")
	}
	m.Flags = flags
	args := []string{"container", "create", "--name", o.container, "--network", o.network, "--label", ownerLabel + "=" + m.Owner, "--label", directoryLabel + "=" + m.DirectoryIdentity, "--user", o.containerUser, "--read-only", "--workdir", "/templates", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--cpus", strconv.FormatFloat(o.cpus, 'f', -1, 64), "--memory", strconv.Itoa(o.memory) + "m", "--memory-swap", strconv.Itoa(o.memory) + "m", "--pids-limit", strconv.Itoa(o.pids), "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--env", "NUCLEI_TEMPLATES_DIR=/templates", "--env", "HOME=/tmp", "--env", "XDG_CONFIG_HOME=/tmp/config", "--env", "XDG_CACHE_HOME=/tmp/cache", "--mount", "type=bind,src=" + filepath.Join(stage, "templates") + ",dst=/templates,readonly", "--mount", "type=bind,src=" + reports + ",dst=/reports"}
	if strings.Contains(abs, ",") {
		return code, errors.New("mount paths containing comma unsupported")
	}
	if o.gateway {
		args = append(args, "--add-host", "host.docker.internal:host-gateway")
	}
	args = append(args, o.image)
	args = append(args, flags...)
	m.ContainerArgs = args
	if _, e = d.call(ctx, args...); e != nil {
		return code, e
	}
	if e = d.owned(ctx, "container", o.container, m); e != nil {
		return code, e
	}
	m.Status = "running"
	if e = writeState(abs, &m); e != nil {
		return invalidArtifact, e
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := d.command(runCtx, "container", "start", "--attach", o.container)
	stdout, e := os.OpenFile(filepath.Join(reports, "stdout.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return invalidArtifact, e
	}
	defer stdout.Close()
	stderr, e := os.OpenFile(filepath.Join(reports, "stderr.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return invalidArtifact, e
	}
	defer stderr.Close()
	shared := &logLimit{remaining: int64(o.maxReport), cancel: cancel}
	cmd.Stdout = &limitedLog{shared, stdout}
	cmd.Stderr = &limitedLog{shared, stderr}
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	var runErr error
	monitorFailed := false
wait:
	for {
		select {
		case runErr = <-done:
			break wait
		case <-ticker.C:
			if _, e = inventory(reports, o.maxReport); e != nil {
				monitorFailed = true
				cancel()
			}
			_ = atomicJSON(filepath.Join(abs, "progress.json"), map[string]any{"version": 1, "status": "running", "time": time.Now().UTC().Format(time.RFC3339)})
		case <-runCtx.Done():
			runErr = <-done
			break wait
		}
	}
	stdout.Close()
	stderr.Close()
	if runErr != nil || runCtx.Err() != nil || shared.exceeded || monitorFailed {
		return toolFailure, errors.New("tool failed, cancelled, exceeded report bound or timed out; partial reports retained")
	}
	b, e = d.call(ctx, "container", "inspect", o.container)
	if e != nil {
		return toolFailure, e
	}
	var states []struct {
		State struct {
			Running   bool `json:"Running"`
			ExitCode  int  `json:"ExitCode"`
			OOMKilled bool `json:"OOMKilled"`
		} `json:"State"`
	}
	if json.Unmarshal(b, &states) != nil || len(states) != 1 || states[0].State.Running || states[0].State.OOMKilled {
		return toolFailure, errors.New("container completion not verified")
	}
	m.ToolExit = states[0].State.ExitCode
	if m.ToolExit != 0 {
		return toolFailure, errors.New("Nuclei returned nonzero exit")
	}
	if m.Findings, e = reportEvidence(abs, m); e != nil {
		return invalidArtifact, e
	}
	_, e = os.Lstat(filepath.Join(reports, "results.sarif"))
	m.NativeSARIFOmitted = os.IsNotExist(e)
	return 0, nil
}

type logLimit struct {
	mu        sync.Mutex
	remaining int64
	exceeded  bool
	cancel    context.CancelFunc
}
type limitedLog struct {
	limit *logLimit
	file  io.Writer
}

func (w *limitedLog) Write(p []byte) (int, error) {
	w.limit.mu.Lock()
	defer w.limit.mu.Unlock()
	n := len(p)
	if int64(n) > w.limit.remaining {
		w.limit.exceeded = true
		p = p[:max(0, w.limit.remaining)]
		w.limit.cancel()
	}
	_, e := w.file.Write(p)
	w.limit.remaining -= int64(len(p))
	return n, e
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func reconcile(ctx context.Context, o options) error {
	if o.cleanupTimeout < 1 || o.cleanupTimeout >= o.timeout {
		return errors.New("explicit cleanup timeout must be smaller than helper timeout")
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		return errors.New("bounded invocation context required")
	}
	ctx, cancel := context.WithDeadline(context.WithoutCancel(ctx), minTime(deadline, time.Now().Add(time.Duration(o.cleanupTimeout)*time.Second)))
	defer cancel()
	if e := validateDocker(o); e != nil {
		return e
	}
	root, m, e := loadRun(o.runDir)
	if e != nil {
		return e
	}
	if o.daemon != m.Daemon || o.container != m.Container || o.network != m.Network || !regexp.MustCompile(`^[a-f0-9]{48}$`).MatchString(m.Owner) {
		return errors.New("explicit reconciliation identity does not match run")
	}
	if m.Status == "complete" {
		if e := validate(root); e != nil {
			m.Status = "incomplete"
			m.Reason = "artifact validation failed before reconciliation"
		}
	}
	config, e := os.MkdirTemp("", "nuclei-reconcile-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(config)
	d := dockerClient{o, config}
	if e = d.cleanup(ctx, m); e != nil {
		return e
	}
	stage := filepath.Join(root, ".staging")
	if st, e := os.Lstat(stage); e == nil {
		if st.Mode()&os.ModeSymlink != 0 || !st.IsDir() {
			return errors.New("unsafe staging path")
		}
		if e = os.RemoveAll(stage); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	m.CleanupConfirmed = true
	if m.Status != "complete" {
		m.Status = "incomplete"
		m.Reason = "explicit cleanup reconciliation completed; original run remains incomplete"
	}
	return writeState(root, &m)
}
