build:
    bun run build

install: build
    mkdir -p "$HOME/.local/bin"
    install -m 755 dist/readrun "$HOME/.local/bin/readrun"
    ln -sf readrun "$HOME/.local/bin/rr"
