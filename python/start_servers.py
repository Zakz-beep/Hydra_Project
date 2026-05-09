import subprocess
import sys
import io
import time
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Daftar API yang akan dijalankan
# Format: (folder_relatif, module_name, port)
apis = [
    (".", "vrp_api3:app", 8000),
    (".", "greeks_api:app", 8001),
    (".", "risk_api:app", 8002),
    (".", "regime_api:app", 8007),
    ("volatality", "api:app", 8006),
    ("correlaction", "api:app", 8004)
]

processes = []

def main():
    # Mendapatkan path absolut dari folder python tempat script ini berada
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        print("[START] Memulai semua server API menggunakan Uvicorn (--host 0.0.0.0 --reload)...")
        for folder_rel, module, port in apis:
            cwd = os.path.join(base_dir, folder_rel)
            
            # Menjalankan uvicorn melalui sys.executable agar konsisten dengan environment
            cmd = [
                sys.executable, "-m", "uvicorn", module, 
                "--host", "0.0.0.0", 
                "--port", str(port), 
                "--reload"
            ]
            
            print(f"[RUN] Menjalankan {module} di port {port} (Folder: {folder_rel})...")
            
            # Membuka subprocess untuk masing-masing API
            p = subprocess.Popen(cmd, cwd=cwd)
            processes.append(p)
            
            # Jeda sebentar agar log tidak menumpuk saat startup
            time.sleep(1)
            
        print("\n[OK] Semua server berhasil dijalankan secara paralel di network lokal (0.0.0.0)!")
        print("Tekan Ctrl+C untuk menghentikan semua server.")
        
        # Menjaga script utama tetap berjalan
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n[STOP] Mematikan semua server...")
        for p in processes:
            p.terminate() # Mengirim sinyal terminate ke subprocess
            
        for p in processes:
            p.wait() # Menunggu proses benar-benar mati
            
        print("[DONE] Semua server telah dihentikan.")

if __name__ == "__main__":
    main()
