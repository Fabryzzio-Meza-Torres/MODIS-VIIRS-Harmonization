"""Container entry point; PORT is supplied by the hosting provider."""
import os
from pathlib import Path
import uvicorn

if __name__ == '__main__':
    uvicorn.run('api:app', app_dir=str(Path(__file__).resolve().parent),
                host='0.0.0.0', port=int(os.environ.get('PORT', '8000')))
