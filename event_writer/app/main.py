import time

from .infrastructure.messaging.consumer import run_consumer


def main():
    while True:
        try:
            run_consumer()
        except Exception as exc:
            print(f"event_writer: retry after error: {exc}")
            time.sleep(2)


if __name__ == "__main__":
    main()
