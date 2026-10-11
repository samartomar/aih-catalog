//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

func configureProcess(cmd *exec.Cmd) {}

func validateContainerUser(v string) error {
	expected := fmt.Sprintf("%d:%d", os.Geteuid(), os.Getegid())
	if v != expected {
		return errors.New("container-user must match effective host UID:GID for private bind mounts")
	}
	return nil
}
