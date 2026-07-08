import type { TermsDocument } from './types.ts'
import { TERMS_VERSION } from '../../../shared/termsVersion.js'

// Nederlandse algemene voorwaarden — een zelfstandig document, onafhankelijk
// van de Engelse versie en van het i18n-systeem. CONCEPT: vereist juridische
// beoordeling vóór publieke lancering.
export const termsNl: TermsDocument = {
  version: TERMS_VERSION,
  title: 'Algemene voorwaarden GigBuddy',
  draftNotice: 'Conceptversie — deze tekst wacht op juridische beoordeling.',
  intro: [
    'Deze voorwaarden beschrijven wat je van GigBuddy mag verwachten en wat wij van jou verwachten. We hebben ze bewust in gewone taal geschreven: is iets onduidelijk, dan is dat een fout — laat het ons weten.',
    'Door een bandomgeving aan te maken of eraan deel te nemen, ga je akkoord met deze voorwaarden.',
  ],
  sections: [
    {
      heading: '1. Wat GigBuddy is',
      paragraphs: [
        'GigBuddy is een online tool voor bands: optredens en repetities plannen, beschikbaarheid, nummers en setlists beheren, contacten bijhouden en — op betaalde abonnementen — de bandfinanciën, zoals facturen en een boekhoudkundig grootboek.',
        'GigBuddy wordt geleverd als online dienst ("software as a service"). Je koopt de software niet; je gebruikt haar zolang je account actief is.',
      ],
    },
    {
      heading: '2. Je account',
      paragraphs: [
        'Je logt in met een bestaand Google- of Microsoft-account. Je bent zelf verantwoordelijk voor de beveiliging van dat account; alles wat via jouw inlog gebeurt, geldt als door jou gedaan.',
        'Eén persoon, één account. Elke band (een "omgeving") heeft een eigenaar wiens abonnement het plan van die band bepaalt, en leden die door de band zelf worden beheerd.',
        'Je moet minimaal 16 jaar oud zijn, of toestemming hebben van een ouder of voogd, om GigBuddy te gebruiken.',
      ],
    },
    {
      heading: '3. Abonnementen, proefperiode en betaling',
      paragraphs: [
        'GigBuddy heeft een gratis abonnement en betaalde abonnementen. Prijzen, limieten en functies per abonnement zie je voordat je afsluit. De betaling verloopt via onze betaalprovider (Mollie); wij zien of bewaren je volledige betaalgegevens nooit.',
        'Nieuwe abonnees krijgen eenmalig een gratis proefperiode. Om die te starten doen we een verificatiebetaling van € 0,01 waarmee je betaalmachtiging wordt vastgelegd. Zeg je op tijdens de proefperiode, dan betaal je niets meer dan die verificatiebetaling.',
        'Abonnementen verlengen automatisch per maand of per jaar, afhankelijk van je keuze, totdat je opzegt. Opzeggen kan op elk moment; een betaalde periode loopt tot de einddatum en wordt niet naar rato terugbetaald, tenzij de wet dat vereist.',
        'Ga je naar een lager abonnement, dan vervallen functies die buiten het nieuwe abonnement vallen. Gegevens worden alleen verwijderd na jouw uitdrukkelijke, geïnformeerde bevestiging van een downgrade — nooit enkel omdat een betaling is mislukt. Verloopt je abonnement, dan valt je omgeving terug op het gratis abonnement en blijven je gegevens bewaard.',
      ],
    },
    {
      heading: '4. Redelijk gebruik (fair use)',
      paragraphs: [
        'Opslag- en gebruikslimieten per abonnement bestaan zodat iedereen een snelle, betrouwbare dienst krijgt. Gebruik GigBuddy waarvoor het bedoeld is: het runnen van je band.',
        'Niet toegestaan: GigBuddy gebruiken voor onrechtmatige inhoud of activiteiten; proberen de beveiliging van de dienst of de gegevens van andere bands te doorbreken of te testen; toegang doorverkopen; de dienst onredelijk belasten (bijvoorbeeld met geautomatiseerde bulkverzoeken); of materiaal uploaden waarvoor je geen rechten hebt.',
        'Bedreigt gebruik de stabiliteit of veiligheid van de dienst ernstig, dan kunnen we een account tijdelijk beperken. We nemen daarover vooraf, of zo snel mogelijk daarna, contact met je op.',
      ],
    },
    {
      heading: '5. Jouw inhoud',
      paragraphs: [
        'Alles wat je in GigBuddy zet — nummers, bestanden, contacten, financiële administratie — blijft van jou. Je geeft ons alleen de technische toestemming die nodig is om het op te slaan, te verwerken en aan je bandleden te tonen, want dat is wat de dienst doet.',
        'Je bent verantwoordelijk voor de inhoud die je band opslaat, inclusief het hebben van de rechten op geüploade bestanden (bijvoorbeeld bladmuziek of opnamen).',
        'Je kunt je eigen gegevens exporteren of verwijderen. Het verwijderen van een omgeving verwijdert ook de inhoud ervan, inclusief financiële administratie — het bewaren van wettelijk verplichte kopieën (bijvoorbeeld voor de fiscale bewaarplicht) is jouw verantwoordelijkheid.',
      ],
    },
    {
      heading: '6. Gegevensbescherming en privacy',
      paragraphs: [
        'We verwerken persoonsgegevens (zoals namen, e-mailadressen en de contacten die je band opslaat) uitsluitend om de dienst te leveren, conform de Algemene verordening gegevensbescherming (AVG). Voor de gegevens die je band over anderen opslaat, is je band de verwerkingsverantwoordelijke en verwerkt GigBuddy ze in jouw opdracht.',
        'We verkopen geen persoonsgegevens en gebruiken je inhoud niet voor advertenties of voor het trainen van AI-modellen.',
        'Gegevens worden opgeslagen binnen de Europese Unie. We gebruiken een klein aantal verwerkers (hosting, betalingen) die gebonden zijn aan verwerkersovereenkomsten.',
        'Je kunt op elk moment inzage, correctie of verwijdering van je persoonsgegevens vragen. Beveiligingsincidenten die jouw gegevens raken, melden we je zonder onnodige vertraging.',
      ],
    },
    {
      heading: '7. Beschikbaarheid en ondersteuning',
      paragraphs: [
        'We streven naar hoge beschikbaarheid, maar leveren GigBuddy zonder uptime-garantie. Onderhoud kondigen we aan wanneer we verwachten dat het storend is.',
        'We maken regelmatig back-ups voor calamiteitenherstel. Deze back-ups vervangen niet je eigen export van administratie die je wettelijk moet bewaren.',
        'Ondersteuning verloopt per e-mail, naar beste kunnen (best effort).',
      ],
    },
    {
      heading: '8. Aansprakelijkheid',
      paragraphs: [
        'GigBuddy is een hulpmiddel voor bands, geen professionele boekhoud-, juridische of fiscale dienst; controleer belangrijke cijfers met je eigen adviseur. We zijn niet aansprakelijk voor indirecte schade zoals gederfde winst of verloren gegevens, behalve wanneer de schade het gevolg is van onze opzet of grove nalatigheid.',
        'Onze totale aansprakelijkheid is in alle gevallen beperkt tot het bedrag dat je ons voor de dienst hebt betaald in de twaalf maanden vóór de schadeveroorzakende gebeurtenis.',
        'Niets in deze voorwaarden beperkt aansprakelijkheid die wettelijk niet beperkt kan worden.',
      ],
    },
    {
      heading: '9. Wijzigingen van deze voorwaarden',
      paragraphs: [
        'We kunnen deze voorwaarden bijwerken. Bij betekenisvolle wijzigingen informeren we je minimaal 30 dagen vooraf in de app en vragen we je de nieuwe versie te accepteren. Ga je niet akkoord, dan kun je opzeggen en je gegevens exporteren voordat de wijziging ingaat.',
      ],
    },
    {
      heading: '10. Toepasselijk recht',
      paragraphs: [
        'Op deze voorwaarden is Nederlands recht van toepassing. Geschillen worden voorgelegd aan de bevoegde rechter in Nederland, tenzij dwingend consumentenrecht je toestaat de rechter van je woonplaats te kiezen.',
      ],
    },
  ],
}
