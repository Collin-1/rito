# Rito Voice Command Reference (MVP)

This file lists likely phrases users might say to Rito.
Use it for demo scripts, QA tests, and intent parser improvements.

## 1) Open Site

Primary intent: `open_site`

- open youtube
- go to youtube
- navigate to youtube
- open youtube dot com
- take me to youtube
- open google
- go to gmail
- open github
- open wikipedia
- open linkedin
- open facebook
- open x
- open twitter

## 2) Search On Site

Primary intent: `search_site`

- search python tutorials on youtube
- search for python tutorials on youtube
- open youtube and search python tutorials
- go to youtube and search for python tutorial
- navigate to youtube and search AI accessibility
- search machine learning in youtube
- search javascript on google
- search for hackathon ideas on google
- search for tsonga culture on wikipedia
- search data science on github

## 3) Summarize Page

Primary intent: `summarize_page`

- summarize this page
- summarize this article
- give me a summary
- summarize what this page says
- can you summarize this
- what is this page about
- short summary please
- summarize in bullet points

## 4) Read Page Aloud

Primary intent: `read_page`

- read this page
- read this article
- read aloud
- speak this page
- read this to me
- start reading
- voice read this

## 5) Simplify Page

Primary intent: `simplify_page`

- explain this page simply
- simplify this page
- make this easier to understand
- rewrite this in simple words
- explain like i am 10
- explain for a beginner
- make this easier

## 6) Scroll Commands

Primary intent: `scroll_page`

- scroll down
- scroll up
- go down
- go up
- scroll to top
- go to top
- scroll to bottom
- go to bottom
- move down the page
- move up the page

## 7) Click Elements

Primary intent: `click_element`

- click login
- click sign in
- click submit
- click next
- click continue
- click search
- click register
- click join
- click menu
- click profile

## 8) Highlight Important Points

Primary intent: `highlight_important_points`

- highlight important points
- highlight key points
- show me important parts
- mark key sentences
- highlight main ideas
- point out the important parts

## 9) Reading Controls

Mapped to popup controls: pause/resume/stop

- pause reading
- pause
- resume reading
- resume
- continue reading
- stop reading
- stop

## 10) Combined / Natural Phrases

These should still map to existing intents.

- open youtube and search python tutorial
- go to google and search easy math lessons
- summarize this page then read it aloud
- explain this page simply and highlight key points
- click login and read what comes next

## 11) Accessibility-Friendly Short Commands

Good for users with low digital literacy.

- open youtube
- search python
- summarize
- read page
- simplify
- scroll down
- scroll up
- click login
- highlight points
- stop

## 12) Xitsonga Examples (MVP list)

- pfula youtube
- famba eka youtube
- lavisisa python tutorials eka youtube
- komisa tluka leri
- hlaya tluka leri
- hlamusela hi ku olova
- skrola ehansi
- skrola ehenhla
- tlilika login

## 13) Zulu Examples (MVP list)

- vula i-youtube
- iya ku-youtube
- sesha i-python tutorials ku-youtube
- fingqa leli khasi
- funda leli khasi
- chaza lokhu kalula
- skrola phansi
- skrola phezulu
- chofoza u-login

## 14) Sepedi Examples (MVP list)

- bula youtube
- eya go youtube
- nyaka python tutorials go youtube
- akaretša letlakala le
- bala letlakala le
- hlaloša ka bonolo
- theogela fase
- rotogela godimo
- tobetsa login

## 15) Common Misrecognitions To Handle

These words are often heard wrong by speech recognition.

- you tube / youtube / u tube
- log in / login / sign in
- summarize / summarise
- read / red
- scroll / scrawl
- simplify / simple-fy
- github / get hub
- wikipedia / wiki pedia

## 16) Intent Testing Checklist

Use these to verify end-to-end behavior.

- "open youtube"
- "go to youtube and search for python tutorial"
- "summarize this page"
- "read this page"
- "explain this page simply"
- "click login"
- "highlight important points"
- "scroll down"
- "scroll to top"

## Notes

- This is a practical MVP phrase bank, not an exhaustive language dictionary.
- Keep adding real user phrases from testing sessions.
- Prefer simple command wording for live demos.
