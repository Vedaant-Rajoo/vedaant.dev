---
title: clai
summary: natural language → shell commands, as a CLI
year: 2026
stack: [Go]
status: active
featured: true
repo: https://github.com/vedaant-rajoo/clai
published: "2026-10-22"
---

## The problem

I know what I want the shell to do more often than I know the exact command. The usual fixes are a search, a man page or a chat window, and then a paste into the terminal. A tool that answers with a command and runs it for me saves the paste, and it also takes away the one moment where I check what is about to happen.

clai is a local-first command compiler with a terminal UI. You describe a task in plain language, such as `run the project tests`, read the command it suggests, edit it if you want, and accept it. clai then prints the command, copies it, or inserts it into your shell prompt at the cursor. It never runs it. You still press Enter.

## My role

Everything is mine: the Go, the shell scripts, the docs and the tests. I started it on 25 June 2026, and the last push was on 8 August, 82 commits later. I worked with coding agents for most of the implementation. The Phase B change went through independent clause-by-clause reviews before it merged, and its pull request records those rounds, including the one that caught a defect in the development endpoint before it shipped.

## Decisions

<dl>
<dt>chose</dt>
<dd>inserting the accepted command at the shell cursor</dd>
<dt>over</dt>
<dd>running it for you</dd>
<dt>because</dt>
<dd>the moment before Enter is the point of the tool. You read the command, change it if you want, and run it yourself. The shell inserts the text at the cursor and leaves what is on either side editable, and cancelling, rejecting the suggestion or any error leaves the prompt exactly as it was.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>a private file under /tmp as the hand-off between clai and the shell</dd>
<dt>over</dt>
<dd>inherited file descriptors, pipes, sockets, locks or an authenticated channel</dd>
<dt>because</dt>
<dd>those defend against a process already running as my user, and I put that inside the trust boundary: your OS account is the boundary, and anything running as you is trusted. The file is mode 0600 in a sticky /tmp, which keeps other users out, and the docs say plainly that it is not a defence against a same-UID adversary.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>leaving a copied command on the clipboard until something overwrites it</dd>
<dt>over</dt>
<dd>a timed clear</dd>
<dt>because</dt>
<dd>a clear would promise what clai cannot deliver. A clipboard manager may already hold the value, a delayed clear can wipe something newer you copied yourself, and checking that the clipboard still holds clai's exact value depends on the backend. A background action is also the wrong shape for a tool built on visible, user-driven steps. Clipboard delivery is opt-in through <code>--copy</code>, and the flag carries the warning instead.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd>streaming that stays inside the transport</dd>
<dt>over</dt>
<dd>showing tokens as they arrive</dd>
<dt>because</dt>
<dd>a command you are about to accept should exist in full before you see any of it. The direct Anthropic provider reads the server-sent event stream, but the UI stays on its loading screen until one complete candidate has been decoded and checked, so partial text, partial JSON, thinking blocks and half a command never reach the review screen, the application result or a request receipt.</dd>
</dl>

<dl>
<dt>chose</dt>
<dd><code>local-only</code> refusing a request to a remote endpoint</dd>
<dt>over</dt>
<dd>dropping the context quietly and sending the intent alone</dd>
<dt>because</dt>
<dd>the context policy governs the machine and repository context around the intent, never whether the intent itself is sent. The intent is the request, so it reaches whichever provider you selected, and under <code>local-only</code> a remote endpoint would still receive it. clai refuses instead of sending an intent-only request, and pasting an intent with Ctrl-V follows the same rule as typing it.</dd>
</dl>

## Architecture

The binary is Go, with Bubble Tea for the UI. A provider turns the intent into candidates. The default provider, `rules`, is a short local table of phrasings (`git status`, `what changed`, `recent commits`, `current branch`, `search for todo`, `where am i`, listening ports and a few more) that sends nothing anywhere and suggests Git commands only when the current directory is inside a repository. `openrouter` and direct `anthropic` are opt-in, selected by flag, environment variable or `config.json`, in that order of precedence, with the rules as the built-in default. `--fallback-rules` returns to the local table when the model errors.

Every candidate then passes three gates before it can be accepted or exported. Validation runs on a bounded shell-syntax parser that accepts one line in a supported subset. The safety policy marks the command allow, warn or block by looking at its real arguments and at pass-through dispatchers, so `find . -exec rm -rf . \;` warns while plain traversal is allowed. Applicability checks the candidate's declared tool, shell and OS requirements against a capability inventory of the machine, which is a fixed allowlist of 14 tools probed with `LookPath`, plus three version probes. The same intent, `search for TODO`, yields `rg TODO` when ripgrep is installed and `grep -r TODO .` when it isn't, and the fixtures prove it.

What a remote provider receives is the intent plus, under the default `remote-minimal` policy, normalized facts only: OS family, shell family, project kind, architecture, and present, absent or version for those 14 tools. It never sends paths, raw probe output, history, prior output, environment, identity, credentials or repository contents. `remote-explicit` adds the working directory, Git root or Git branch, each named with a `--share-context` flag on that invocation, and the approval is not persisted. Credentials live in the OS keyring with a locked, symlink-free file fallback, and the API key travels in a header, never in the JSON body.

The widget hand-off is a file. The shell creates it empty with mode 0600 under /tmp, and ignores an inherited `TMPDIR`, because a writable directory without the sticky bit would let someone replace the path. clai checks that the path is absolute, a regular file, private and empty before the UI starts, and that it is still the same file before it writes. The shell then reads it, deletes it and inserts the text. Those checks catch mistakes, which is all they claim to catch.

For testing the remote path without spending money, `--dev-endpoint` redirects a provider to a loopback address, where a small stub server plays scripted scenarios. The check is lexical, so a hostname that merely resolves to loopback is refused, and every screen that can show a candidate is labelled with the effective endpoint.

## A piece of it

This is the heart of the Fish adapter that `clai init fish` prints. The file is forced to mode 0600 before clai ever sees it; clai writes into it only after the three gates pass; the shell reads it only on a zero exit, deletes the path, and then `commandline -i` inserts the text at the cursor. Nothing in it runs the command.

```fish
    if not command chmod 600 "$result_file"
        command rm -f -- "$result_file"
        return 1
    end

    command "$clai_command" widget --shell fish --result-file "$result_file"
    set -l widget_status $status
    set -l result

    if test $widget_status -eq 0; and test -s "$result_file"
        set result (string collect --no-trim-newlines < "$result_file")
    end

    command rm -f -- "$result_file"

    if test $widget_status -eq 0; and test -n "$result"
        commandline -i -- "$result"
    end
```

## Trade-offs

The trust model is narrow by choice, and the docs list what clai does not promise: no isolation from processes running as the same user, no authenticated transport, no secure erasure, no memory zeroization, no deletion from clipboard-manager history. A crash can leave a 0600 file holding one command in /tmp for the system's own cleanup. Pasted text is bounded to 8 KiB inside clai, but the OS and the terminal may have handled the whole clipboard value before that bound applied, and clai shows the truncation.

The local table is small. Most real intents need a remote provider, and then the intent text leaves the machine. The parser supports a subset of shell, so an idiomatic pipeline can come back marked invalid. Running against a real model showed `fd … | xargs -I{} du -h {} | sort -rh` rejected until literal `{}` was treated as word data, and the prompts now name the supported subset instead of leaving the model to guess at undisclosed rules. Widget mode needs a Unix-like system with a controlling terminal, so there is no Windows support. After the one-way move of config and credentials to the XDG roots on macOS, older binaries sharing those roots are unsupported.

The tests outweigh the code: 49 source files and 49 test files, roughly 13,000 lines of Go against 20,000 lines of tests, plus PTY integration tests that prove insertion at the cursor. That weight is what the review-first promise costs, and I think it is worth it.

## Outcome

As of August 2026 clai installs with `go install github.com/Vedaant-Rajoo/clai/cmd/clai@latest` on Go 1.26.2 or newer and is MIT licensed. There is no tagged release yet. CI runs `gofmt`, `go vet` and `go test` on every push and pull request. Three pull requests have merged. The third exists because a branch update made from the pre-merge parent overwrote a squash merge three minutes after it landed, so the recovery replayed the 66 missing files as one ordinary commit, byte for byte identical to the merged tree, without a force push. The privacy contract is one document, `docs/privacy.md`. The README, the shell guides, the provider guide and the CLI help summarise it and link back, so the normative wording lives in one place and the rest cannot drift far from it.

## Links

- Repository: https://github.com/vedaant-rajoo/clai
- Trust and retention contract: https://github.com/vedaant-rajoo/clai/blob/dev/docs/privacy.md
- Providers and context privacy: https://github.com/vedaant-rajoo/clai/blob/dev/docs/providers.md
- Shell integration: https://github.com/vedaant-rajoo/clai/blob/dev/docs/shell/README.md
