# Schrijfstijl

> [!TIP]
>
> This is a generic Dutch writing-style guide, for courses taught in the
> Netherlands. Copy this file over `context/writing-style.md` in your project
> and delete this tip. It is a usable baseline, not a fill-in-the-blanks
> template: nothing is marked `TODO`, and the rules work as written for most
> Dutch-language courses. Colleagues in Flanders want
> [`writing-style-nl-be.md`](writing-style-nl-be.md) instead, which adds the
> Flemish register rules. Adjust the few course-specific spots (emoji meanings,
> code-comment language) to taste, or run `/writing-style-init` to have your AI
> assistant adapt the whole guide to samples of your own writing.
> `context/writing-style.md` is protected during
> [upstream updates](../docs/updating-your-project.md), so your copy sticks.

Het cursusmateriaal is in het Nederlands, en deze gids ook.

## Doelgroepen

Cursusteksten hebben twee doelgroepen en dus twee registers. Kies het juiste
voor het bestand dat je onder handen hebt.

- **Studentgericht**: alles in `course/` en `evaluations/`, plus de instructies
  bij opdrachten en tentamens. Warm, toegankelijk, ERK B2.
- **Collegagericht**: lesplannen in `sources/lessons/`, klasversies in
  `sources/lesson-plans/`, en verder alle bronnotities en werkdocumenten in
  `sources/`. Direct, droog, geen plafond op de leesbaarheid. Alsof je met een
  collega praat, of alsof je een uitgegeven didactische handleiding leest.

Het laagst genummerde lesplan in `sources/lessons/` is het uitgewerkte voorbeeld
voor het collegagerichte register.

`AGENTS.md` en de gidsen in `docs/` horen bij het toolingproject, niet bij je
cursus. Die volgen het collegagerichte register plus de regels in
[Contributing](../docs/contributing.md#documentation-style), en het is niet aan
jou om ze te herschrijven: een upstream-update overschrijft `docs/` volledig, en
`AGENTS.md` is daartegen beschermd, dus een aanpassing daar sleep je voorgoed
mee. Pas hier de stem van je cursus aan; laat die bestanden met rust.

`README.md` wisselt van eigenaar. Tot `npx course setup` het vervangt door dat
van je cursus is het van het toolingproject, en daarna van jou.

De rest van deze gids valt uiteen in **gedeelde regels** (voor allebei),
**studentgericht** en **collegagericht**.

## Gedeelde regels

### Taal

- **Standaardnederlands.** "je"/"jullie", en "jij" waar het natuurlijk valt. "U"
  alleen waar je echt afstand wilt.
- **Engelse vaktermen blijven Engels:** _markup_, _selector_, _property_,
  _whitespace_, _screenreader_, _deploy_, _commit_, _framework_. Ze krijgen
  Nederlandse lidwoorden en meervouden: _de selector_, _selectors_.
- **Natuurlijk Nederlands, geen vertaald Engels.** De tekst moet klinken alsof
  hij meteen in het Nederlands geschreven is. Let op:
  - Letterlijk vertaalde Engelse uitdrukkingen: _"in hun gezicht"_ voor _in
    their face_, _"iets draagbaar maken"_ voor _make X bearable_, _"een vlag
    planten"_ voor _plant a flag_, _"sociaal bewijs"_ voor _social proof_.
  - Engels zinsritme in Nederlandse woorden: bijzinnen die op elkaar stapelen,
    lange tussenzinnen midden in de zin.
  - Calques van Engelse collocaties en beelden die de vertaling niet overleven
    (_"een ingang heropenen"_ voor _reopen an entry-point_).
- **Eenvoudige woorden boven geleerde:** "gebruiken" in plaats van "hanteren",
  "kijk na" in plaats van "ga over tot verificatie".

### Structuur van een pagina

Begin met één of twee zinnen context en kom dan ter zake. Geen meta-inleidingen
à la "In dit onderdeel bekijken we…".

- **Genummerde lijsten** voor stappen in volgorde.
- **Opsommingen** voor lijstjes en het uiteenrafelen van een concept. Zet er bij
  concepten een korte **vetgedrukte** aanzet voor:
  ```md
  - **Leesbare code:** je code is beter leesbaar en duidelijker
    gestructureerd.
  - **Minder verrassingen:** wie het bestand later opent, ziet meteen hoe
    het in elkaar zit.
  ```
- **Korte alinea's** voor uitleg. Geen lappen tekst.
- **Codeblokken** voor alles wat je typt, toont of laat kopiëren.
- **Tussenkoppen** om langere pagina's op te delen. Begin bij `##` voor de
  hoofddelen, `###` spaarzaam. Nooit `#`: dat niveau is van de paginatitel.

### Koppen en titels

- **Geen kop van niveau 1 in de tekst.** De `title` in de frontmatter is de kop
  van de pagina, overal waar je cursus verschijnt: op de website, in Canvas en
  in de export naar PDF, Word en markdown. Een `#` in de tekst toont die titel
  dus een tweede keer, en `npx course validate` meldt de pagina. Tussenkoppen
  beginnen bij `##`.
- **Alleen zinskapitaal.** Enkel het eerste woord en eigennamen of afkortingen.
  Nooit elk woord met een hoofdletter.
  - Goed: `## Een logische mappenstructuur voor je project`
  - Fout: `## Een Logische Mappenstructuur Voor Je Project`
- Kort en beschrijvend. Geen leesteken op het eind, behalve `?` bij een echte
  vraag.
- Afkortingen in hun gangbare vorm: URL, HTTP, API, PDF, FAQ.

### Leestekens en typografie

- **Geen kastlijnen (—).** AI-tell. Neem een komma, een dubbele punt, haakjes of
  een nieuwe zin.
- **Half kastlijntje (–)** voor bereiken (`2023–2024`).
- Typografische aanhalingstekens `‘’` en `“”`.
- Beletselteken `…`, spaarzaam.
- Eén uitroepteken tegelijk.

### Patronen om te vermijden (AI-tells)

Tekst die naar een machine ruikt, kost je sneller het vertrouwen van je
studenten dan een tikfout. Loop ze dus na voor je publiceert.

De eerste drie groepen duiken op in tekst uit elk model. De laatste drie zijn de
vaste trekjes van één assistent: bewaar de groepen voor de modellen die je
gebruikt en schrap de rest.

**Openingen en overgangen**

- "Laten we erin duiken", "Aan het eind van deze les kun je…".
- Retorische vragen als aanloop: "Maar wat betekent dat nu concreet voor jou?"
- "In de snel veranderende wereld van…", en elke andere alinea die eerst het
  decor opzet.
- Uitbundige openingen: "Geweldig!", "Fantastisch!".

**Op zinsniveau**

- **Zinnen die klinken als een letterlijke vertaling uit het Engels.** Dit is de
  duidelijkste vingerafdruk van AI-tekst in het Nederlands: het model denkt in
  het Engels en trekt er Nederlandse woorden over. Je herkent het aan:
  - "je zult willen…" voor _you'll want to_, "in staat zijn om te" voor _be able
    to_, "wanneer het aankomt op" voor _when it comes to_, "dat gezegd zijnde"
    voor _that being said_, "het is de moeite waard om op te merken".
  - "zorg ervoor dat" als automatische vertaling van _make sure_ en _ensure_,
    waar een gebiedende wijs korter is.
  - De lijdende vorm waar het Nederlands de bedrijvende neemt.
  - Tangconstructies en werkwoorden die pas helemaal achteraan landen omdat de
    Engelse zin nu eenmaal zo liep.
  - De toets: lees de zin hardop. Hoor je het Engelse origineel erdoorheen, dan
    moet hij anders, hoe correct hij ook staat. Zie ook de regel over natuurlijk
    Nederlands bij [Taal](#taal), die over je eigen schrijfgewoonten gaat; deze
    hier gaat over wat je bij het nalezen tegenkomt.
- "Het is belangrijk om op te merken dat…": laat de aanloop weg en zeg het.
- De constructie "niet alleen X, maar Y", en haar neefje "X gaat niet over A,
  maar over B".
- Sierlijke drieslagen: "snel, eenvoudig en efficiënt".
- Gestapelde slagen om de arm: "kan in bepaalde gevallen mogelijk tot op zekere
  hoogte helpen".
- Vage bronvermelding: "experts zeggen", "studies tonen aan", zonder bron.
- Woorden die veel vaker in gegenereerde tekst opduiken dan in de jouwe:
  _cruciaal_, _naadloos_, _robuust_, _duiken in_, _benadrukken_, _een schat
  aan_, en _navigeren_ in figuurlijke zin.

**Vorm en ritme**

- Vet verspreid door de lopende tekst. Vet hoort bij de aanzet van een opsomming
  of bij een term die je definieert.
- Elke alinea die eindigt op een samenvattende zin.
- De kop herhalen als eerste zin van het onderdeel.
- Opsommingen waarin elk item even lang is en identiek gebouwd. Echte lijstjes
  zijn hobbelig.
- Perfect uitgebalanceerde onderdelen, overal drie bolletjes, van boven tot
  onder.
- Zinnen van gelijke lengte en gelijke bouw, in de pas. Wissel het ritme af.

**Claude**

- Omzeild "is": "dient als", "fungeert als", "vormt" waar "is" volstaat.
- Aangehangen "wat"-staarten: "…, wat het belang van X onderstreept", "…, wat
  bredere trends weerspiegelt".
- Ongevraagde geruststelling: "Je bent niet de enige", "Je beeldt het je niet
  in".
- Assistentenstem die in de tekst doorsijpelt: "Goede vraag", "Je hebt helemaal
  gelijk", "Ik help je graag verder".

**ChatGPT (OpenAI)**

- Emoji als versiering in koppen en opsommingen (🚀, ✅, 💡).
- "Kortom" / "Tot slot" als afsluiter, en "Hopelijk helpt dit!".
- Hypewoorden: "game-changer", "ontgrendelen", "naar een hoger niveau tillen",
  "revolutionair".
- Een tabel voor informatie die geen tabel is.
- "Kort antwoord: … Lang antwoord: …" en "TL;DR" als steiger.

**Gemini**

- "Hier is een overzicht:", en antwoorden die alleen uit geneste opsommingen
  bestaan, drie niveaus diep.
- "In essentie", "In wezen", "Uiteindelijk" als alinea-openers.
- "Zie het als…"-analogieën voor alles.
- Ongevraagde disclaimers en voorbehouden op het eind.

### Links

- Officiële, duurzame bronnen: de documentatie van de tool zelf,
  standaardisatieorganisaties, de referentiepagina's van de leverancier.
- Interne links met relatieve `.md`-paden.

### Codevoorbeelden

- Afgebakende blokken met een taallabel (` ```js `, ` ```python `, ` ```bash `).
- Het kleinste fragment dat het punt maakt.
- Commentaar in de code in het Nederlands.

## Studentgericht materiaal

### Leesniveau

**ERK B2** (CEFR B2). Korte, concrete zinnen. Splits een lange zin liever in
twee dan er nog een bijzin aan te hangen. Leg een term uit bij het eerste
gebruik en gebruik hem daarna vrij.

### Stem en toon

De standaardstem voor uitleg:

- **Tweede persoon, direct.** "je maakt", "probeer", "sla op". Gebiedende wijs
  in stappen.
- **"We" voor wat jullie samen in de les doen.** "We bekijken samen…"
- **"Ik" voor persoonlijke ervaring en mening.** Welkom, laat het staan.
- **Warm, af en toe speels.** Feliciteer ("Gefeliciteerd!"), geef toe dat iets
  vervelend is, laat er een grapje of een Engelse uitdrukking in glippen waar
  het past. Forceer het niet.
- **Eerlijk.** Heeft Windows het deze ene keer makkelijker, zeg dat dan.
- **Tussenzinnen tussen haakjes mogen** in uitleg, maar niet in elke alinea.

### Oefeningen, opdrachten en tentamens: duidelijkheid eerst

Bij instructies moet een student kunnen beginnen zonder iets te vragen. Laat de
warme toon vallen zodra die de duidelijkheid in de weg staat:

- Geen tussenzinnen tussen haakjes, geen grapjes, geen "ik" of "we", geen speels
  Engels.
- Korte gebiedende zinnen, ondubbelzinnige stappen, en expliciet wat er af moet
  en binnen welke grenzen.
- In de _inleiding_ van een opdracht mag de toon lichter zijn; vanaf de
  instructies zelf wint de duidelijkheid.

### Emoji in paginatitels

Een paginatitel mag beginnen met een emoji die het type pagina aangeeft. Eén is
de standaard; een tweede mag als die echt iets toevoegt (❗️📅 voor een opdracht
met een deadline), nooit een derde. Gebruik je er twee, volg dan de volgorde van
de lijst hieronder. Past geen enkele emoji uit de lijst, gebruik dan nu en dan
een andere; keert die terug, zet hem dan hier in de lijst met zijn betekenis.

- ❗️ opdracht (in te leveren, al dan niet voor een cijfer)
- 💯 tentamen- of toetsmateriaal
- 🏠 huiswerk
- 📅 heeft een deadline
- 👥 groepswerk
- 💬 discussie
- 📝 iets schrijven
- 📖 iets lezen
- 🛠 iets maken
- ⚙️ installatie / setup
- 📦 startbestanden / download
- 🧪 zelf proberen / experiment
- 🔎 onderzoeken
- 💪 oefenen
- 🔑 oplossing
- 🚸 extra hulp
- 🧩 extra oefening
- 📘 uitleg / referentie
- 🎬 video
- 📽 presentatie
- 📕 samenvatting
- ⚠️ belangrijk
- 💣 pas op / gevaarlijk
- ℹ️ extra info
- 🔁 herhaling

Emoji blijven op de titel: geen in de tussenkoppen op de pagina, in opsommingen
of in lopende tekst. Studenten lezen deze gids nooit; zet de legenda dus op de
startpagina van je cursus, want bewegwijzering werkt pas als de lezer de borden
kent.

### Callouts (GitHub-alerts)

Houd ze kort. Groeit de inhoud voorbij een paar regels, zet ze dan in de pagina
zelf.

- `[!NOTE]` achtergrond, "meer weten"
- `[!TIP]` een tip of een sneltoets
- `[!IMPORTANT]` mag niemand missen
- `[!WARNING]` klassieke valkuil
- `[!ATTENTION]` dringend, nu handelen
- `[!CHECK]` controlestap

`[!ATTENTION]` is de schrijfwijze van dit project voor wat GitHub `[!CAUTION]`
noemt; allebei werken ze, en de titel die verschijnt komt uit het label
`caution` in `course.config.yml`.

### "Meer weten"-links

Zet achtergrond en verder leesvoer in een `[!NOTE]` op het eind van een
onderdeel.

## Collegagericht materiaal

Voor lesplannen (`sources/lessons/`), klasversies (`sources/lesson-plans/`),
bronnotities en werkdocumenten in `sources/`. Het publiek zijn collega's, geen
studenten. Het laagst genummerde lesplan in `sources/lessons/` is het voorbeeld
om te volgen.

### Leesniveau

Moedertaal of C2. Niets vereenvoudigen. Samengestelde zinnen mogen als ze hun
gewicht dragen; kies toch liever twee korte zinnen dan één gestapelde, want
ritme telt.

### Stem en toon

- **Direct, droog, af en toe speels.** Alsof je met een collega in de
  docentenkamer praat, of alsof je een uitgegeven didactische handleiding leest.
  De warmte zit in de precisie en de droge vaststelling, niet in het inpakken.
- **Zet je punt vooraan.** Geen aanloopalinea's, geen "In dit lesplan beschrijf
  ik…". Eén zin context, dan ter zake.
- **Zinsfragmenten mogen** als ze harder aankomen: _"Drie concepten. Meer
  niet."_ _"Iedereen slaagt."_
- **"Ik" en "je" mogen allebei.** _"Je modelleert leerdoel 4 door voor hun ogen
  voor te doen wat debuggen is."_ _"Ik loop rond en stel vragen."_ Gebruik "ik"
  spaarzaam, voor persoonlijke ervaring of voor een afweging die je als de jouwe
  wilt markeren.
- **Geen afrondende samenvattingen.** Stop als het punt gemaakt is.
- **Zeg wat je verwacht.** Geen defensieve slagen om de arm ("het zou kunnen dat
  sommige studenten…"). Verwacht je het, schrijf het dan.

### Structuur

- Geen emoji in paginatitels. Dat is bewegwijzering voor studenten.
- Korte alinea's en opsommingen waar ze helpen, net als in de gedeelde
  structuurregels hierboven. Lesplannen gebruiken meestal `##` voor blokken en
  fases, en `###` voor de onderdelen met een tijdvak.
