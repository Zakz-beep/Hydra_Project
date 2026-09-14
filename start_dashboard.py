"""One entry point for all registered Python backends and the Next.js frontend."""
from python.start_servers import main

if __name__ == '__main__':
    raise SystemExit(main(include_frontend=True))
