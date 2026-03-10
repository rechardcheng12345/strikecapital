#!/bin/bash

set -e

cleanup() {
  kill 0
}

trap cleanup EXIT INT TERM

npm run dev:server &
npm run dev:client &

wait
