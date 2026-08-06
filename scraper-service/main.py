import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl

load_dotenv()

app = FastAPI(title="VoC Copilot Scraper Service")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")


class ScrapeRequest(BaseModel):
    url: HttpUrl


class ScrapeGraphRequest(BaseModel):
    url: HttpUrl
    prompt: str = "Extract all customer reviews as a list of plain text strings."


class ScrapeResponse(BaseModel):
    engine: str
    url: str
    content: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scrape/crawl4ai", response_model=ScrapeResponse)
async def scrape_crawl4ai(req: ScrapeRequest):
    from crawl4ai import AsyncWebCrawler

    try:
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=str(req.url))
        if not result.success:
            raise HTTPException(status_code=502, detail=result.error_message or "crawl4ai failed")
        return ScrapeResponse(
            engine="crawl4ai", url=str(req.url), content=result.markdown or ""
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/scrape/scrapling", response_model=ScrapeResponse)
async def scrape_scrapling(req: ScrapeRequest):
    from scrapling.fetchers import Fetcher

    try:
        page = Fetcher.get(str(req.url))
        text = page.get_all_text(ignore_tags=("script", "style"))
        return ScrapeResponse(engine="scrapling", url=str(req.url), content=text or "")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/scrape/scrapegraph", response_model=ScrapeResponse)
async def scrape_scrapegraph(req: ScrapeGraphRequest):
    # scrapegraphai's own package currently has a broken internal dependency
    # chain (its pinned langchain-community/langchain-core combination doesn't
    # import cleanly). We reproduce its actual behavior directly instead:
    # fetch the page, then let an LLM (Groq) extract per the prompt.
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not set for this service")

    from groq import Groq

    fetched = await scrape_crawl4ai(ScrapeRequest(url=req.url))

    client = Groq(api_key=GROQ_API_KEY)
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You extract information from scraped web page content per the user's instruction. Respond with only the extracted content.",
                },
                {
                    "role": "user",
                    "content": f"Instruction: {req.prompt}\n\nPage content:\n{fetched.content}",
                },
            ],
            temperature=0.2,
        )
        content = completion.choices[0].message.content or ""
        return ScrapeResponse(engine="scrapegraph", url=str(req.url), content=content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/scrape/selenium", response_model=ScrapeResponse)
def scrape_selenium(req: ScrapeRequest):
    # Plain `def` (not `async def`) — FastAPI runs sync endpoints in a worker
    # thread automatically, which is required here since Selenium's API is
    # blocking and would otherwise stall the whole asyncio event loop.
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")

    driver = None
    try:
        # Selenium 4.6+ ships "Selenium Manager", which auto-resolves a
        # matching chromedriver binary — no manual driver install needed.
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(30)
        driver.get(str(req.url))
        text = driver.find_element("tag name", "body").text
        return ScrapeResponse(engine="selenium", url=str(req.url), content=text or "")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if driver:
            driver.quit()


@app.post("/scrape/scrapy", response_model=ScrapeResponse)
def scrape_scrapy(req: ScrapeRequest):
    # A full Scrapy spider runs its own Twisted reactor, which can't share
    # the asyncio event loop FastAPI already owns (and can only start once
    # per process). For a single-page fetch, using Scrapy's own Selector
    # (its real CSS/XPath text-extraction engine) directly over a plain HTTP
    # fetch is the standard lightweight pattern — genuinely Scrapy's parsing
    # code, just without spinning up the full crawl-process machinery that
    # a one-off request doesn't need.
    import requests
    from scrapy import Selector

    try:
        resp = requests.get(str(req.url), timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        sel = Selector(text=resp.text)
        texts = sel.xpath("//body//text()[not(ancestor::script) and not(ancestor::style)]").getall()
        content = "\n".join(t.strip() for t in texts if t.strip())
        return ScrapeResponse(engine="scrapy", url=str(req.url), content=content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


EngineName = Literal["crawl4ai", "scrapling", "scrapegraph", "selenium", "scrapy"]


class UnifiedScrapeRequest(BaseModel):
    url: HttpUrl
    engine: EngineName = "crawl4ai"


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape_unified(req: UnifiedScrapeRequest):
    if req.engine == "crawl4ai":
        return await scrape_crawl4ai(ScrapeRequest(url=req.url))
    if req.engine == "scrapling":
        return await scrape_scrapling(ScrapeRequest(url=req.url))
    if req.engine == "scrapegraph":
        return await scrape_scrapegraph(ScrapeGraphRequest(url=req.url))
    if req.engine == "selenium":
        return scrape_selenium(ScrapeRequest(url=req.url))
    if req.engine == "scrapy":
        return scrape_scrapy(ScrapeRequest(url=req.url))
    raise HTTPException(status_code=400, detail=f"Unknown engine: {req.engine}")
