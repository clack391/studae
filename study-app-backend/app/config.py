"""ONE place to choose which AI model each feature uses.

HOW TO SWITCH A MODEL
---------------------
Find the feature in the "FEATURE -> MODEL" section and set it to any model id.
You can use a shortcut constant or just paste the model name as a string:

    LESSON = CLAUDE_SONNET          # use a shortcut
    LESSON = "claude-haiku-4-5"     # or write the model id directly
    LESSON = "gemini-2.5-flash"     # or switch provider entirely
    LESSON = "gpt-4o"               # or use OpenAI

The provider is detected automatically from the model name:
    claude-*  -> Anthropic        gemini-*  -> Google
    gpt-* / o3-* / text-embedding-* -> OpenAI
So you do NOT pick a provider anywhere; just name the model.

REQUIREMENTS / GOTCHAS
----------------------
- OpenAI models need OPENAI_API_KEY in the environment (.env). Claude needs
  ANTHROPIC_API_KEY, Gemini needs GEMINI_API_KEY (already set).
- Cost is logged per model id in clients._PRICING. If you switch to a model not
  listed there, it still runs but its cost logs as $0 until you add a price.
- EMBED is special: changing it changes the vector space, so ALL existing chunks
  must be re-embedded, and the model must output 1536 dims to match the DB
  column (e.g. gemini-embedding-001 or OpenAI text-embedding-3-small). Claude
  has no embeddings model.
"""

# ============================ MODEL IDS ====================================
# Shortcut names for the models in use. Bump a version string here once and
# every feature pointing at it follows. (You can also ignore these and write a
# model id directly on a feature below.)

# Anthropic Claude
CLAUDE_HAIKU = "claude-haiku-4-5"     # cheap + fast, the default workhorse
CLAUDE_SONNET = "claude-sonnet-4-6"   # higher quality, used on graded paths
CLAUDE_OPUS = "claude-opus-4-8"       # highest quality, not used by default

# Google Gemini
GEMINI_FLASH_LITE = "gemini-2.5-flash-lite"  # fast vision/text (typed OCR)
GEMINI_FLASH = "gemini-2.5-flash"            # stronger vision (handwriting/math)
GEMINI_EMBED = "gemini-embedding-001"        # text embeddings (1536-dim)

# OpenAI (only used if you point a feature at one; needs OPENAI_API_KEY)
OPENAI_GPT = "gpt-4o"                         # general text + vision
OPENAI_GPT_MINI = "gpt-4o-mini"              # cheaper text + vision
OPENAI_EMBED = "text-embedding-3-small"      # 1536-dim, matches the DB column


# ====================== FEATURE  ->  MODEL =================================
# Set any feature to any model id (constant above or a plain string). Defaults
# preserve the original tiering: Sonnet only on the three quality-sensitive
# graded paths (question generation, figure-question text fallback, grading);
# everything else on Haiku. Flip a Haiku entry up if its quality dips.

# --- Ask (chat about a document / a photographed question) ---
ASK = CLAUDE_HAIKU                   # answer a typed question
ASK_PHOTO = CLAUDE_HAIKU             # answer a photographed question
ASK_EXTRACT_PHOTO = CLAUDE_HAIKU     # read the question(s) out of a photo
ASK_FILTER_SOURCES = CLAUDE_HAIKU    # pick the relevant chunks to answer from
ASK_PHOTO_FIGURE_FILTER = CLAUDE_HAIKU  # keep only figures relevant to a photo ask
ASK_TAG_TOPIC = CLAUDE_HAIKU         # tag a question with its topic

# --- Lesson ---
LESSON = CLAUDE_HAIKU                 # generate a lesson
LESSON_FIGURE_FILTER = CLAUDE_HAIKU   # keep only figures relevant to the lesson

# --- Summary ---
SUMMARY = CLAUDE_HAIKU               # topic summary + outline summary

# --- Assessment (test / exam) ---
ASSESSMENT_GENERATE = CLAUDE_SONNET         # write the questions
ASSESSMENT_REGEN_TEXT_ONLY = CLAUDE_SONNET  # figure-question text-only fallback
ASSESSMENT_FIGURE_VERIFY = CLAUDE_HAIKU     # vision-check a figure fits a question
ASSESSMENT_DIAGRAM_VERIFY = CLAUDE_HAIKU    # check an AI-generated Mermaid diagram fits a question

# --- Review / grading ---
GRADING = CLAUDE_SONNET              # grade a submitted answer
REVIEW_FIGURE_FILTER = CLAUDE_HAIKU  # keep only figures relevant on review

# --- Prep (revision + flashcards) ---
REVISION = CLAUDE_HAIKU              # revise weak areas
FLASHCARDS = CLAUDE_HAIKU            # generate flashcards

# --- Upload / ingest ---
OCR = GEMINI_FLASH_LITE              # OCR a typed / printed page
OCR_HANDWRITING = GEMINI_FLASH       # OCR handwriting / heavy math
DIAGRAM_DETECT = GEMINI_FLASH_LITE   # vision-detect diagram regions on scanned pages
OUTLINE = CLAUDE_HAIKU               # build the document outline after ingest

# --- Embedding (see EMBED gotcha at top before changing) ---
EMBED = GEMINI_EMBED                 # embed chunks for vector search
