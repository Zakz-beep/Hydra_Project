import sys
import os

# Add the python directory to sys.path so we can import ml_models
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ml_models.gru_regim import GRURegimeEngine

def test():
    print("Initializing GRURegimeEngine...")
    try:
        engine = GRURegimeEngine(ticker="SPY")
        
        if engine.model is None:
            print("Model artifacts not found. Starting a quick training run (5 epochs)...")
            engine.train(epochs=5)
            
        print("Running predict_latest()...")
        result = engine.predict_latest()
        
        print("\nPREDICTION RESULT:")
        import json
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test()
