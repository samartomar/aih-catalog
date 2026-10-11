// nuclei-helper is a standalone, deliberately bounded workflow helper.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const (
	preflight        = 10
	toolFailure      = 11
	invalidArtifact  = 12
	cleanupUncertain = 13
)

type stringsFlag []string

func (s *stringsFlag) String() string     { return fmt.Sprint([]string(*s)) }
func (s *stringsFlag) Set(v string) error { *s = append(*s, v); return nil }

type options struct {
	output, runDir, bundle, hash, target, daemon, docker, image, container, network, mode, reuse, reuseHash string
	official, data, custom, customData, hosts                                                               stringsFlag
	timeout, toolTimeout, cleanupTimeout, maxOutput, maxDownload, maxReport, memory, pids, rate             int
	length, reuseLength                                                                                     int64
	cpus                                                                                                    float64
	gateway                                                                                                 bool
}

func main() { os.Exit(cli(os.Args[1:], os.Stdout)) }
func cli(args []string, out io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(out, "expected prepare, run, validate or reconcile")
		return preflight
	}
	o := options{}
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&o.output, "output", "", "absent preparation directory")
	fs.StringVar(&o.runDir, "run-dir", "", "run directory")
	fs.StringVar(&o.bundle, "bundle", "", "template bundle")
	fs.StringVar(&o.hash, "bundle-sha256", "", "exact bundle sha256")
	fs.Int64Var(&o.length, "bundle-bytes", 0, "exact bundle byte length")
	fs.StringVar(&o.reuse, "reuse-bundle", "", "explicit previous bundle")
	fs.StringVar(&o.reuseHash, "reuse-sha256", "", "previous bundle sha256")
	fs.Int64Var(&o.reuseLength, "reuse-bytes", 0, "previous bundle length")
	fs.Var(&o.official, "official", "selected official template path (repeat)")
	fs.Var(&o.data, "official-data", "declared official data path (repeat)")
	fs.Var(&o.custom, "custom", "local source=relative bundle path (repeat)")
	fs.Var(&o.customData, "custom-data", "declared local data source=relative bundle path (repeat)")
	fs.Var(&o.hosts, "allow-host", "exact authorized hostname (repeat)")
	fs.StringVar(&o.target, "target", "", "one HTTP(S) target")
	fs.StringVar(&o.daemon, "daemon", "", "local Docker endpoint")
	fs.StringVar(&o.docker, "docker-cli", "", "Docker executable")
	fs.StringVar(&o.image, "image", "", "preinstalled digest-pinned image")
	fs.StringVar(&o.container, "container", "", "unique container name")
	fs.StringVar(&o.network, "network", "", "unique bridge name")
	fs.StringVar(&o.mode, "target-mode", "", "public, private or local-host")
	fs.BoolVar(&o.gateway, "host-gateway", false, "explicit Linux host gateway mapping")
	fs.Float64Var(&o.cpus, "cpus", 0, "CPU limit")
	fs.IntVar(&o.memory, "memory-mib", 0, "memory limit MiB")
	fs.IntVar(&o.pids, "pids", 0, "PID limit")
	fs.IntVar(&o.rate, "rate-limit", 0, "requests per second")
	fs.IntVar(&o.timeout, "timeout-seconds", 0, "helper deadline")
	fs.IntVar(&o.toolTimeout, "tool-timeout-seconds", 0, "Nuclei soft deadline")
	fs.IntVar(&o.cleanupTimeout, "cleanup-timeout-seconds", 0, "cleanup deadline")
	fs.IntVar(&o.maxOutput, "max-output-bytes", 0, "console byte bound")
	fs.IntVar(&o.maxDownload, "max-download-bytes", 0, "total downloaded byte bound")
	fs.IntVar(&o.maxReport, "max-report-bytes", 0, "total report byte bound")
	if err := fs.Parse(args[1:]); err != nil || fs.NArg() != 0 {
		fmt.Fprintln(out, "invalid arguments")
		return preflight
	}
	if o.timeout < 1 || o.timeout > 900 || o.maxOutput < 128 || o.maxOutput > 1048576 {
		fmt.Fprintln(out, "explicit timeout-seconds (1..900) and max-output-bytes (128..1048576) required")
		return preflight
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(o.timeout)*time.Second)
	defer cancel()
	var err error
	code := preflight
	switch args[0] {
	case "prepare":
		err = prepare(ctx, o)
	case "run":
		code, err = run(ctx, o)
	case "validate":
		code = invalidArtifact
		err = validate(o.runDir)
	case "reconcile":
		code = cleanupUncertain
		err = reconcile(ctx, o)
	default:
		err = errors.New("unknown command")
	}
	if err != nil {
		msg := fmt.Sprintf("%s failed: %s\n", args[0], err)
		if len(msg) > o.maxOutput {
			msg = msg[:o.maxOutput-1] + "\n"
		}
		io.WriteString(out, msg)
		return code
	}
	message := fmt.Sprintf("%s completed; inspect the declared output directory\n", args[0])
	if args[0] == "prepare" {
		var m bundleManifest
		b, e := readRegular(filepath.Join(o.output, "preparation.json"), 1<<20)
		if e == nil && json.Unmarshal(b, &m) == nil {
			message = ""
			if len(m.Warnings) > 0 {
				message = "WARNING: selected custom HTTP sources may be unsigned.\n"
			}
			message += fmt.Sprintf("prepare %s; tag=%s commit=%s sha256=%s bytes=%d\n", m.Outcome, m.Tag, m.Commit, m.SHA256, m.Bytes)
		}
	}
	if len(message) > o.maxOutput {
		message = message[:o.maxOutput-1] + "\n"
	}
	io.WriteString(out, message)
	return 0
}
func atomicJSON(path string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	return atomicBytes(path, append(b, '\n'))
}
func atomicBytes(path string, b []byte) error {
	f, e := os.CreateTemp(filepathDir(path), ".atomic-")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	return os.Rename(name, path)
}
