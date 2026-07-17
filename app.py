import os
import threading
from fastapi import FastAPI, UploadFile, File, Form, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from PyPDF2 import PdfReader
from google import genai

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

KEY_FILE = "api_key.txt"

def load_secure_credential() -> str:
    if not os.path.exists(KEY_FILE):
        with open(KEY_FILE, "w") as f:
            f.write("PASTE_YOUR_GEMINI_API_KEY_HERE")
        return "PASTE_YOUR_GEMINI_API_KEY_HERE"
    with open(KEY_FILE, "r") as f:
        return f.read().strip()

active_key = load_secure_credential()
client = genai.Client(api_key=active_key)

extracted_text = ""
uploaded_filename = ""

CATEGORIZED_SUBJECTS = {
    "specialised": {
        "fc_bc": {"name": "Field Craft and Battle Craft (FC & BC)", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "map_reading": {"name": "Map Reading (MR)", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "obstacle_training": {"name": "Obstacle Training (OT)", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "rifle_shooting": {"name": "Rifle Shooting", "text": "", "filename": "", "status": "Ready (Fallback Mode)"}
    },
    "general": {
        "being_a_cadet": {"name": "Being a Cadet", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "camp_preparation": {"name": "Camp Preparation", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "current_affairs": {"name": "Current Affairs", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "health_hygiene": {"name": "Health & Hygiene", "text": "", "filename": "", "status": "Ready (Fallback Mode)"},
        "uniform_rules": {"name": "Uniform Rules", "text": "", "filename": "", "status": "Ready (Fallback Mode)"}
    }
}

SUBJECTS_DIR = "subjects"
processing_lock = threading.Lock()

def scan_and_load_pdf_worker():
    """Worker function to process PDFs in the background without blocking server startup."""
    global CATEGORIZED_SUBJECTS
    
    # Acquire lock to prevent overlapping runs
    if not processing_lock.acquire(blocking=False):
        return

    try:
        if not os.path.exists(SUBJECTS_DIR):
            os.makedirs(SUBJECTS_DIR)
            
        for category, subjects in CATEGORIZED_SUBJECTS.items():
            for sub_key, sub_data in subjects.items():
                target_dir = os.path.join(SUBJECTS_DIR, sub_key)
                
                if not os.path.exists(target_dir):
                    os.makedirs(target_dir)
                    continue
                    
                pdf_files = [f for f in os.listdir(target_dir) if f.lower().endswith('.pdf')]
                if not pdf_files:
                    continue
                
                if sub_data["text"]: 
                    continue
                    
                target_path = os.path.join(target_dir, pdf_files[0])
                sub_data["filename"] = pdf_files[0]
                sub_data["status"] = "Parsing Document..."
                
                try:
                    # Parse text safely
                    pdf_reader = PdfReader(target_path)
                    text = ""
                    for page in pdf_reader.pages:
                        text += page.extract_text() or ""
                    sub_data["text"] = text.strip()
                    sub_data["status"] = "Loaded Successfully" if sub_data["text"] else "Loaded (Empty Text/Fallback)"
                except Exception as e:
                    print(f"Skipping unreadable document {pdf_files[0]}: {str(e)}")
                    sub_data["status"] = "Loaded (Fallback Active)"
    except Exception as g_err:
        print(f"Background scanner anomaly: {str(g_err)}")
    finally:
        processing_lock.release()

def get_flat_subject(subject_name: str):
    for category, subjects in CATEGORIZED_SUBJECTS.items():
        if subject_name in subjects:
            return subjects[subject_name]
    return None

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, background_tasks: BackgroundTasks):
    # Triggers scanning in the background immediately so startup is lightning fast
    background_tasks.add_task(scan_and_load_pdf_worker)
    
    flat_subjects_status = {}
    for category, subjects in CATEGORIZED_SUBJECTS.items():
        for sub_key, sub_data in subjects.items():
            flat_subjects_status[sub_key] = sub_data["filename"] if sub_data["filename"] else None
            
    return templates.TemplateResponse(
        request, 
        name="dashboard.html",
        context={
            "custom_file": uploaded_filename,
            "subjects": flat_subjects_status,
            "specialised_subjects": CATEGORIZED_SUBJECTS["specialised"],
            "general_subjects": CATEGORIZED_SUBJECTS["general"]
        }
    )

@app.get("/custom", response_class=HTMLResponse)
async def custom_chat(request: Request):
    return templates.TemplateResponse(
        request, name="custom.html", context={"filename": uploaded_filename}
    )

@app.get("/subject/{subject_name}", response_class=HTMLResponse)
async def subject_chat(request: Request, subject_name: str):
    target_subject = get_flat_subject(subject_name)
    if not target_subject:
        return RedirectResponse(url="/")
        
    return templates.TemplateResponse(
        request, 
        name="subject.html", 
        context={
            "filename": target_subject["filename"], 
            "subject_name": subject_name,
            "display_name": target_subject["name"]
        }
    )

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    global extracted_text, uploaded_filename
    try:
        pdf_reader = PdfReader(file.file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() or ""
        extracted_text = text.strip()
        uploaded_filename = file.filename
        return {"message": "Manual analyzed successfully."}
    except Exception as e:
        return {"error": f"Failed to parse manual: {str(e)}"}

@app.post("/ask")
async def ask_instructor(question: str = Form(...)):
    global extracted_text
    if not extracted_text:
        return {"response": "No training material loaded. Please deploy your NCC notes first, Cadet."}
    return await execute_briefing(question, extracted_text)

@app.post("/subject/{subject_name}/ask")
async def ask_subject(subject_name: str, question: str = Form(...)):
    target_subject = get_flat_subject(subject_name)
    if not target_subject:
        return {"response": "Invalid course structure."}
    
    context_text = target_subject["text"]
    if not context_text:
        context_text = (
            f"Subject track: {target_subject['name']}. "
            "Operational training reference loaded. Provide core textbook principles, "
            "field procedures, manual regulations, and direct alignments based on your absolute knowledge base."
        )
        
    return await execute_briefing(question, context_text)

async def execute_briefing(question: str, context: str):
    global client
    current_key = load_secure_credential()
    if current_key != "PASTE_YOUR_GEMINI_API_KEY_HERE":
        client = genai.Client(api_key=current_key)

    prompt = f"""
    ROLE & IDENTITY:
    You are a real, highly disciplined Associate NCC Officer (ANO) conducting a face-to-face oral briefing with a cadet. 
    Address the user directly as 'Cadet'. You are NOT an AI assistant or a chatbot—never use robotic transition phrases. 
    
    DELIVERY ARCHITECTURE:
    - Go directly to the core answer in the first syllable. 
    - Keep sentences short, crisp, and conversational yet authoritative so it sounds completely natural and easy to understand when spoken aloud via Text-to-Speech.
    - Break information down cleanly. Avoid long paragraphs or blocks of text.
    
    STRATEGIC DIRECTIVE MODE:
    Educational and instructional style. Provide crisp board definitions, precise terminology, and structured manual alignments. Clear, authoritative, perfectly ordered, and optimized for teaching foundational concepts clearly.

    CONTEXTUAL GROUND TRUTH:
    {context[:12000]}
    
    CADET TRANSMISSION: {question}
    """
    try:
        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=prompt,
        )
        return {"response": response.text.strip()}
    except Exception as e:
        return {"response": f"Communication link error: {str(e)}"}
    