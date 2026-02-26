import os
import time
import sqlite3
import win32serviceutil
import win32service
import pywintypes
import requests
import json




WAIT_TIMEOUT = 30  # seconds

URL = "http://localhost:8082/wssndque"

payload = {
    "message": "caules son los requisitos para rentar un vehiculo para hacer Uber"
}

headers = {
    "Content-Type": "application/json"
}

def send_request():
    try:
        response = requests.post(
            URL,
            headers=headers,
            data=json.dumps(payload),
            timeout=30
        )
        print("Status:", response.status_code)
        print("Response:", response.json())
    except Exception as e:
        print("Error:", e)


def get_database_path():
    ellstack_dir = os.environ.get("ELLSTACK_DIR")
    if not ellstack_dir:
        raise Exception("ELLSTACK_DIR environment variable not set")

    return os.path.join(ellstack_dir, "data", "ellsdb")


def get_service_status(SERVICE_NAME):
    try:
        status = win32serviceutil.QueryServiceStatus(SERVICE_NAME)[1]
        return status
    except Exception as e:
        print(f"Error querying service: {e}")
        return None


def control_service(command,SERVICE_NAME):
    try:
        status = get_service_status(SERVICE_NAME)
        if status is None:
            return False

        if command == "STOP":
            if status == win32service.SERVICE_STOPPED:
                print("Service already stopped.")
                return True

            print("Stopping service...")
            win32serviceutil.StopService(SERVICE_NAME)
            win32serviceutil.WaitForServiceStatus(
                SERVICE_NAME,
                win32service.SERVICE_STOPPED,
                WAIT_TIMEOUT
            )
            print("Service stopped.")
            return True

        elif command == "RUN":
            if status == win32service.SERVICE_RUNNING:
                print("Service already running.")
                return True

            print("Starting service...")
            win32serviceutil.StartService(SERVICE_NAME)
            win32serviceutil.WaitForServiceStatus(
                SERVICE_NAME,
                win32service.SERVICE_RUNNING,
                WAIT_TIMEOUT
            )
            print("Service started.")
            return True

    except pywintypes.error as e:
        print(f"Windows service error: {e}")
        return False
    except Exception as e:
        print(f"Unexpected service error: {e}")
        return False


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
                 
                 control_service(command,'ellStackAINodel')
                 control_service(command,'ellStackAIApi')
                 success = control_service(command,'ellStackWhatsapp_serveri')

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




if __name__ == "__main__":
      while True:
        send_request()
        check_sqlite_and_execute()
        time.sleep(5)
   
   