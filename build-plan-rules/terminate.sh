#!/bin/bash

# Terminate script for Podman to completely clean the environment

echo "Stopping all running containers..."
podman stop -a || true

echo "Removing all containers..."
podman rm -a -f || true

echo "Removing all images..."
podman rmi -a -f || true

echo "Removing all volumes..."
# podman volume ls -q returns all volume names, xargs helps prevent errors if empty
podman volume ls -q | xargs -r podman volume rm -f || true

echo "Pruning system completely (networks, dangling build cache, etc.)..."
podman system prune -a --volumes -f

echo "Podman environment has been completely wiped!"
