# git-cleanup

Tidy up unneeded git worktrees and branches

## Installation

```sh
$ deno install --global --allow-env --allow-read --allow-run=git jsr:@canac/git-cleanup
```

## Usage

With no arguments, clean up the repo in the current directory:

```sh
$ git cleanup
```

Pass one or more paths to clean up several repos at once:

```sh
$ git cleanup /projects/repo-a /projects/repo-b
```
