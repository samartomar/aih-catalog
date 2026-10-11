package main

import (
	"bytes"
	"testing"
)

func TestCLIRejectsMissingPreparationLimits(t *testing.T) {
	var out bytes.Buffer
	if code := cli([]string{"prepare", "--output", t.TempDir() + "/snapshot"}, &out); code != 10 {
		t.Fatalf("code=%d output=%s", code, out.String())
	}
}

func invoke(t *testing.T, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	code := cli(args, &out)
	return code, out.String()
}
func limits() []string { return []string{"--timeout-seconds", "30", "--max-output-bytes", "4096"} }
