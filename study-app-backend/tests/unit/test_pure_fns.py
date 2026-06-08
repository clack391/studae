"""Pure-function tests: no network, no fixtures needed beyond the import
guard in conftest. Covers chunk_pages / chunk_page_text windowing,
classify_content_type branches, _sanitize_text, and the figure-bracket
shape gate (_has_phrase_shaped_bracket)."""
from app import ingest


# --------------------------------------------------------------------------
# _sanitize_text
# --------------------------------------------------------------------------

def test_sanitize_strips_null_and_controls():
    raw = "a\x00b\x07c\x1fd\x7fe"
    assert ingest._sanitize_text(raw) == "abcde"


def test_sanitize_keeps_tab_newline_cr():
    raw = "line1\tcol2\nline2\r\nline3"
    # tabs, newlines, carriage returns are printable whitespace -> kept.
    assert ingest._sanitize_text(raw) == raw


def test_sanitize_keeps_unicode():
    raw = "café — naïve ✓ math: 2≤3"
    assert ingest._sanitize_text(raw) == raw


def test_sanitize_tolerates_none_and_empty():
    # Regression: a blank/illegible page where Gemini OCR returns None must
    # NOT crash ingest. This was a TypeError in _CONTROL_CHARS_RE.sub(None)
    # that failed a whole 42-page document on its last blank page.
    assert ingest._sanitize_text(None) == ""
    assert ingest._sanitize_text("") == ""


def test_chunk_page_text_tolerates_none():
    # None/empty page text -> zero chunks, no crash. The per-page ingest loop
    # then treats it as a zero-chunk page and advances the cursor.
    assert ingest.chunk_page_text(None) == []
    assert ingest.chunk_page_text("") == []


# --------------------------------------------------------------------------
# chunk_page_text / chunk_pages — size + overlap windowing
# --------------------------------------------------------------------------

def test_chunk_page_text_single_window_when_short():
    text = " ".join(["w"] * 10)
    chunks = ingest.chunk_page_text(text, size=800, overlap=100)
    assert chunks == [text]


def test_chunk_page_text_windows_with_overlap():
    # 25 words, size 10, overlap 4 -> stride 6.
    words = [f"w{i}" for i in range(25)]
    chunks = ingest.chunk_page_text(" ".join(words), size=10, overlap=4)
    # windows start at 0, 6, 12, 18, 24
    assert len(chunks) == 5
    assert chunks[0].split() == words[0:10]
    assert chunks[1].split() == words[6:16]
    assert chunks[2].split() == words[12:22]
    assert chunks[3].split() == words[18:28]   # tail truncated
    assert chunks[4].split() == words[24:25]
    # overlap is real: last 4 words of chunk0 == first 4 of chunk1
    assert chunks[0].split()[-4:] == chunks[1].split()[:4]


def test_chunk_page_text_empty_is_no_chunks():
    assert ingest.chunk_page_text("   ") == []
    assert ingest.chunk_page_text("") == []


def test_chunk_page_text_sanitizes_before_chunking():
    # NULLs vanish; the two real words survive as one chunk.
    chunks = ingest.chunk_page_text("hel\x00lo\x00 world", size=800)
    assert chunks == ["hello world"]


def test_chunk_pages_preserves_page_numbers():
    pages = [(1, " ".join(["a"] * 5)), (2, " ".join(["b"] * 5))]
    out = ingest.chunk_pages(pages, size=800, overlap=100)
    assert out == [(" ".join(["a"] * 5), 1), (" ".join(["b"] * 5), 2)]


def test_chunk_pages_matches_chunk_page_text_per_page():
    text = " ".join([f"x{i}" for i in range(30)])
    pages = [(7, text)]
    paged = ingest.chunk_pages(pages, size=8, overlap=2)
    single = ingest.chunk_page_text(text, size=8, overlap=2)
    assert [c for c, _ in paged] == single
    assert all(pn == 7 for _, pn in paged)


def test_chunk_pages_skips_blank_pages():
    pages = [(1, ""), (2, "real content here")]
    out = ingest.chunk_pages(pages)
    assert out == [("real content here", 2)]


# --------------------------------------------------------------------------
# classify_content_type — figure / math / text branches
# --------------------------------------------------------------------------

def test_classify_figure_bracketed_short():
    assert ingest.classify_content_type("[A diagram of the nephron]") == "figure"


def test_classify_figure_requires_full_bracket_wrap():
    # Bracket not wrapping the whole stripped string -> not a figure.
    assert ingest.classify_content_type("intro [aside] more") == "text"


def test_classify_figure_too_long_is_not_figure():
    big = "[" + ("x " * 300) + "]"
    assert ingest.classify_content_type(big) != "figure"


def test_classify_math_latex_markers():
    for m in ("\\frac{a}{b}", "\\int x dx", "\\sum_i", "\\sqrt2", "$$x$$", "\\(y\\)"):
        assert ingest.classify_content_type("text " + m) == "math"


def test_classify_math_dollar_count():
    # four or more $ -> math even without a backslash marker.
    assert ingest.classify_content_type("$a$ and $b$") == "math"


def test_classify_plain_text():
    assert ingest.classify_content_type("Just a normal sentence about cells.") == "text"


# --------------------------------------------------------------------------
# _has_phrase_shaped_bracket — the figure shape gate
# --------------------------------------------------------------------------

def test_shape_gate_phrase_bracket_triggers():
    assert ingest._has_phrase_shaped_bracket("see [A diagram of the nephron] here")


def test_shape_gate_keyword_bracket_triggers():
    # single figure keyword is enough even with < 3 words
    assert ingest._has_phrase_shaped_bracket("[figure]")
    assert ingest._has_phrase_shaped_bracket("[fig 2]")


def test_shape_gate_citation_bracket_does_not_trigger():
    assert not ingest._has_phrase_shaped_bracket("as shown [1] earlier")
    assert not ingest._has_phrase_shaped_bracket("refs [0,1] and [2]")


def test_shape_gate_short_non_keyword_bracket_does_not_trigger():
    # two words, no keyword -> below the >=3-word threshold
    assert not ingest._has_phrase_shaped_bracket("[see above]")


def test_shape_gate_empty_bracket_does_not_trigger():
    assert not ingest._has_phrase_shaped_bracket("[]")
    assert not ingest._has_phrase_shaped_bracket("no brackets at all")
