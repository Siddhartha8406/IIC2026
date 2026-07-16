import os
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from PyPDF2 import PdfReader
from google import genai

app = FastAPI()
from fastapi.staticfiles import StaticFiles  # Add this import at the top

app = FastAPI()

# ADD THIS LINE: Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

client = genai.Client()
extracted_text = ""

@app.get("/", response_class=HTMLResponse)
async def read_item(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    global extracted_text
    try:
        pdf_reader = PdfReader(file.file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() or ""
        
        extracted_text = text
        return {"message": "Fall in! Training manual loaded successfully, Cadet!"}
    except Exception as e:
        return {"error": f"Failed to process manual: {str(e)}"}

@app.post("/ask")
async def ask_teacher(question: str = Form(...), mode: str = Form(...)):
    global extracted_text
    if not extracted_text:
        return {"response": "Cadet, upload your training manual first! That's an order!"}

    mode_instructions = {
        "commanding": "Be brief, direct, and use sharp tactical bullet points. No fluff.",
        "academy": "Provide deep academic context, precise definitions, and official NCC guidelines.",
        "camp": "Explain using real-world field analogies, outdoor training scenarios, or leadership stories."
    }

    selected_instruction = mode_instructions.get(mode, mode_instructions["commanding"])

    prompt = f"""
    You are a highly disciplined, proud, and deeply encouraging NCC (National Cadet Corps) Training Instructor.
    Address the user as 'Cadet'. Use clear military/NCC terminology naturally.
    Your task is to answer the Cadet's question based strictly on the source text provided below.

    Specific Mode Instruction for this response:
    {selected_instruction}

    Source Text:
    {extracted_text[:10000]}
    
    Cadet's Question: {question}
    """

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        return {"response": response.text}
    except Exception as e:
        return {"response": f"Error on the parade ground: {str(e)}"}

@app.post("/quiz")
async def generate_quiz():
    global extracted_text
    if not extracted_text:
        return {"response": "Upload a manual first before demanding a test, Cadet!"}

    prompt = f"""
    You are an NCC Instructor. Generate exactly one multiple-choice question (MCQ) based on the source text below to test the cadet's knowledge.
    Format your response EXACTLY like this layout so the application can render it neatly:
    
    **QUESTION:** [Write the question here]
    A) [Option A]
    B) [Option B]
    C) [Option C]
    D) [Option D]
    **CORRECT_ANSWER:** [Write only the correct option letter, e.g., A or B or C or D]
    **EXPLANATION:** [Brief military explanation of why it is right]

    Source Text:
    {extracted_text[:10000]}
    """

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        return {"quiz_text": response.text}
    except Exception as e:
        return {"error": str(e)}