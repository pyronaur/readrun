build:
    bun run build

install: build
    mkdir -p "$HOME/.local/bin"
    install -m 755 dist/mr "$HOME/.local/bin/mr"
