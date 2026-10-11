package main

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// External helpers in the supported Nuclei DSL have effects outside the one
// reviewed HTTP target. Underscoreless aliases are registered by the DSL too.
// Token inspection never evaluates an expression or decodes user data.
func externalCall(text string) error {
	for i := 0; i < len(text); {
		if text[i] == '\'' || text[i] == '"' {
			quote := text[i]
			i++
			for i < len(text) {
				if text[i] == '\\' {
					i += 2
					continue
				}
				if text[i] == quote {
					i++
					break
				}
				i++
			}
			continue
		}
		// govaluate unescapes identifiers before helper lookup. Refuse that
		// alternate spelling syntax while leaving quoted string/regex escapes intact.
		if text[i] == '\\' {
			return fmt.Errorf("escaped identifiers are unsupported in executable expressions")
		}
		if !identifierStart(text[i]) {
			i++
			continue
		}
		start := i
		i++
		for i < len(text) && identifierPart(text[i]) {
			i++
		}
		name := strings.ReplaceAll(strings.ToLower(text[start:i]), "_", "")
		j := i
		for j < len(text) {
			r, n := utf8.DecodeRuneInString(text[j:])
			if !unicode.IsSpace(r) {
				break
			}
			j += n
		}
		if j < len(text) && text[j] == '(' {
			switch name {
			case "resolve", "publicip", "jarm", "llmprompt", "file", "readfile", "dns", "getenv", "exec":
				return fmt.Errorf("external DSL helper %q is outside the reviewed HTTP capability set", text[start:i])
			}
		}
	}
	return nil
}
func identifierStart(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_' }
func identifierPart(c byte) bool  { return identifierStart(c) || c >= '0' && c <= '9' }

// Every source-level interpolation is inspected even when nested in a quoted
// string. Plain DSL matcher/extractor positions are inspected as expressions.
// Nuclei's supported renderer treats evaluated output as terminal data; this
// does not attempt to interpret pure helper output as another expression.
func validateExpressions(text string, direct bool) error {
	if direct {
		if e := externalCall(text); e != nil {
			return e
		}
	}
	for cursor := 0; cursor < len(text); {
		next := strings.Index(text[cursor:], "{{")
		if next < 0 {
			break
		}
		start := cursor + next + 2
		end := -1
		var quote byte
		for i := start; i < len(text); i++ {
			if quote != 0 {
				if text[i] == '\\' {
					i++
					continue
				}
				if text[i] == quote {
					quote = 0
				}
				continue
			}
			if text[i] == '\'' || text[i] == '"' {
				quote = text[i]
				continue
			}
			if strings.HasPrefix(text[i:], "}}") {
				end = i
				break
			}
		}
		if end < 0 {
			return fmt.Errorf("unterminated template expression")
		}
		if e := externalCall(text[start:end]); e != nil {
			return e
		}
		cursor = start
	}
	return nil
}
