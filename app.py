import os
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from PyPDF2 import PdfReader
from google import genai

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

api_key = "AQ.Ab8RN6LUhuuqC0ZNcFOOLrEBtNDiPcxkPkhygCxoiV3dvpdmoA"
client = genai.Client(api_key=api_key)

# Global memory state preserved specifically for the Custom Chat workflow
extracted_text = ""
uploaded_filename = ""

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Default master landing page containing available chat options."""
    global uploaded_filename
    return templates.TemplateResponse(
        request, 
        name="dashboard.html",
        context={"custom_file": uploaded_filename}
    )

@app.get("/custom", response_class=HTMLResponse)
async def custom_chat(request: Request):
    """Routes directly to our previously built feature-complete workspace."""
    global uploaded_filename
    return templates.TemplateResponse(
        request, 
        name="custom.html",
        context={"filename": uploaded_filename}
    )

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    global extracted_text, uploaded_filename
    try:
        pdf_reader = PdfReader(file.file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() or ""
        extracted_text = text
        uploaded_filename = file.filename
        return {"message": "Manual analyzed successfully. Standing by for cadet transmissions."}
    except Exception as e:
        return {"error": f"Failed to parse military manual: {str(e)}"}

@app.post("/ask")
async def ask_instructor(question: str = Form(...), mode: str = Form("teaching")):
    global extracted_text
    if not extracted_text:
        return {"response": "No training material loaded. Please deploy your NCC notes first, Cadet."}

    mode_guidelines = {
        "teaching": (
            "Educational and instructional style. Provide crisp board definitions, precise terminology, "
            "and structured manual alignments. Clear, authoritative, perfectly ordered, and optimized "
            "for teaching foundational concepts clearly."
        )
    }
    
    selected_guideline = mode_guidelines.get(mode, mode_guidelines["teaching"])

    prompt = f"""
    ROLE & IDENTITY:
    You are a real, highly disciplined Associate NCC Officer (ANO) conducting a face-to-face oral briefing with a cadet. 
    Address the user directly as 'Cadet'. You are NOT an AI assistant or a chatbot—never use robotic transition phrases like "Based on the manual", "According to the text", "As requested", or introductory pleasantries. 
    
    DELIVERY ARCHITECTURE:
    - Go directly to the core answer in the first syllable. 
    - Keep sentences short, crisp, and conversational yet authoritative so it sounds completely natural and easy to understand when spoken aloud via Text-to-Speech.
    - Break information down cleanly. Avoid long paragraphs or blocks of text.
    
    STRATEGIC DIRECTIVE MODE:
    {selected_guideline}

    CONTEXTUAL GROUND TRUTH:
    {extracted_text[:12000]}
    
    CADET TRANSMISSION: {question}
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        return {"response": response.text.strip()}
    except Exception as e:
        return {"response": f"Communication link error: {str(e)}"}