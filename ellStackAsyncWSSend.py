import os
import time
import sqlite3
import win32serviceutil
import win32service 
import pywintypes
import requests
import json
import subprocess
import threading
from datetime import datetime

WAIT_TIMEOUT = 30  # seconds

URL = "http://localhost:8082/wssndque"
URL_AI = "http://localhost:8082/aibres"

payload = {
    "message": "caules son los requisitos para rentar un vehiculo para hacer Uber"
}

headers = {
    "Content-Type": "application/json"
}

# Track last execution time
last_run_minute = None
last_qdrant_check = 0


# ==============================
# HTTP REQUEST
# ==============================
def send_request():
    def _request():
        try:
            requests.post(
                URL,
                headers=headers,
                data=json.dumps(payload),
                timeout=30  # small timeout since we don't care about response
            )
        except Exception as e:
            print("Error:", e)

    # Run in background thread (non-blocking)
    threading.Thread(target=_request, daemon=True).start()       



def send_request_ai():
    def _request_ai():
        try:
            requests.post(
                URL_AI,
                headers=headers,
                data=json.dumps(payload),
                timeout=5  # small timeout since we don't care about response
            )
        except Exception as e:
            print("Error:", e)

    # Run in background thread (non-blocking)
    threading.Thread(target=_request_ai, daemon=True).start()       


# ==============================
# ENSURE QDRANT IS RUNNING
# ==============================
def ensure_qdrant_running():
    try:
        result = subprocess.run(
            ["tasklist"],
            capture_output=True,
            text=True
        )

        if "qdrant.exe" in result.stdout.lower():
            print("qdrant.exe is already running.")
            return True

        ellstack_dir = os.environ.get("ELLSTACK_DIR")
        if not ellstack_dir:
            raise Exception("ELLSTACK_DIR environment variable not set")

        qdrant_path = os.path.join(ellstack_dir, "data", "qdrant", "qdrant.exe")

        if not os.path.exists(qdrant_path):
            raise Exception(f"qdrant.exe not found at {qdrant_path}")

        print("Starting qdrant.exe...")
        
        qdrant_dir = os.path.dirname(qdrant_path)

        subprocess.Popen(
            [qdrant_path],
            cwd=qdrant_dir,   # 👈 CRITICAL FIX
            shell=True
        )

        return True

    except Exception as e:
        print("Error ensuring qdrant is running:", e)
        return False


def ensure_qdrant_running_throttled(interval=30):
    global last_qdrant_check
    now = time.time()

    if now - last_qdrant_check > interval:
        ensure_qdrant_running()
        last_qdrant_check = now


# ==============================
# RUN TRMD
# ==============================
def run_trmd_if_needed():
    global last_run_minute

    now = datetime.now()

    # Condition: after 8:00 PM or before 7:00 PM
    if now.hour >= 20 or now.hour < 19:
        if now.minute in (0, 15, 30, 45):
            if last_run_minute != now.minute:
                try:
                    print("Running ellstack_trmd.exe...")
                    subprocess.Popen(["ellstack_trmd.exe"], shell=True)
                    last_run_minute = now.minute
                except Exception as e:
                    print("Error running ellstack_trmd.exe:", e)


# ==============================
# DATABASE PATH
# ==============================
def get_database_path():
    ellstack_dir = os.environ.get("ELLSTACK_DIR")
    if not ellstack_dir:
        raise Exception("ELLSTACK_DIR environment variable not set")

    return os.path.join(ellstack_dir, "data", "ellsdb")


# ==============================
# WINDOWS SERVICE CONTROL
# ==============================
def get_service_status(SERVICE_NAME):
    try:
        status = win32serviceutil.QueryServiceStatus(SERVICE_NAME)[1]
        return status
    except Exception as e:
        print(f"Error querying service: {e}")
        return None


def control_service(command, SERVICE_NAME):
    try:
        status = get_service_status(SERVICE_NAME)
        if status is None:
            return False

        if command == "STOP":
            if status == win32service.SERVICE_STOPPED:
                print(f"{SERVICE_NAME} already stopped.")
                return True

            print(f"Stopping {SERVICE_NAME}...")
            win32serviceutil.StopService(SERVICE_NAME)
            win32serviceutil.WaitForServiceStatus(
                SERVICE_NAME,
                win32service.SERVICE_STOPPED,
                WAIT_TIMEOUT
            )
            print(f"{SERVICE_NAME} stopped.")
            return True

        elif command == "RUN":
            if status == win32service.SERVICE_RUNNING:
                print(f"{SERVICE_NAME} already running.")
                return True

            print(f"Starting {SERVICE_NAME}...")
            win32serviceutil.StartService(SERVICE_NAME)
            win32serviceutil.WaitForServiceStatus(
                SERVICE_NAME,
                win32service.SERVICE_RUNNING,
                WAIT_TIMEOUT
            )
            print(f"{SERVICE_NAME} started.")
            return True

    except pywintypes.error as e:
        print(f"Windows service error: {e}")
        return False
    except Exception as e:
        print(f"Unexpected service error: {e}")
        return False


# ==============================
# SQLITE CHECK
# ==============================
def check_sqlite_and_execute():
    db_path = get_database_path()

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT param_value
            FROM local_setting
            WHERE param = 'SERVICE_COMMAND'
            LIMIT 1
        """)

        row = cursor.fetchone()

        if row:
            command = row[0].strip().upper()

            if command in ("STOP", "RUN"):

                control_service(command, 'ellStackAINodel')
                control_service(command, 'ellStackAIApi')
                success = control_service(command, 'ellStackWhatsapp_serveri')

                if success:
                    cursor.execute("""
                        UPDATE local_setting
                        SET param_value = ''
                        WHERE param = 'SERVICE_COMMAND'
                    """)
                    conn.commit()
                    print("Database value reset.")
            else:
                print("No valid command found.")

        else:
            print("No SERVICE_COMMAND record found.")

    except Exception as e:
        print(f"Database error: {e}")

    finally:
        conn.close()


# ==============================
# MAIN LOOP
# ==============================
if __name__ == "__main__":
    while True:
        ensure_qdrant_running_throttled()   # 👈 Qdrant watchdog

        send_request()
        send_request_ai()
        check_sqlite_and_execute()
        run_trmd_if_needed()

        time.sleep(2)