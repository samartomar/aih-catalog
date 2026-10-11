//go:build windows

package main

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func configureProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }

func validateContainerUser(v string) error {
	parts := strings.Split(v, ":")
	if len(parts) != 2 {
		return errors.New("explicit numeric container-user UID:GID required")
	}
	for _, p := range parts {
		n, e := strconv.ParseUint(p, 10, 32)
		if e != nil || n > 4294967294 || strconv.FormatUint(n, 10) != p {
			return errors.New("container-user requires canonical UID:GID in 0..4294967294")
		}
	}
	return nil
}
