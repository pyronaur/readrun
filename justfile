build:
    cd markrun && bun run build

install: build
    mkdir -p "$HOME/.local/bin"
    install -m 755 markrun/dist/mr "$HOME/.local/bin/mr"
