// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : OFFLINE v2.2 — Navigation instantanée
// ================================================================

const SW_VERSION = 'arvexa-offline-v5.0'; // v5.0 : LECTURE EN PDF (consigne propriétaire : « un PDF par partie, ouverture locale depuis la page lecture ») — (1) lecture.html : chaque partie ouvre le PDF local cours/<matiere>/<chapitre>/<fichier>.pdf quand il existe (sonde HEAD légère, sonde hors-ligne relue depuis le cache grâce à match() qui ignore la méthode) ; lecteur intégré iframe #view=FitH sur desktop, et sur mobile/écran tactile une carte « Ouvrir le PDF » (les iframes PDF sont peu fiables sur Android) — repli automatique sur le rendu HTML si le PDF est absent (zéro régression) ; TTS masqué en mode PDF, restauré au retour HTML ; le PDF consulté est mis en cache silencieusement via postMessage CACHE_URL (lecture hors-ligne). (2) SW : handleGeneric ne met en cache que les GET — une réponse HEAD (sonde de disponibilité des PDF) ne doit jamais écraser l'entrée GET d'une même URL. Les PDF restent hors précache (lourds) : cache à la consultation. // v4.31 : HORS-LIGNE FIABLE (2 trous révélés par le test réel v4.30) — (1) cache.match des pages/cours passe en ignoreSearch : une navigation hors-ligne avec paramètres d'URL (« lecture.html?subject=…&chapter=… ») retrouve désormais le cache — avant, le match incluait la query string et l'élève tombait sur offline.html alors que la page était en cache ; (2) le préchauffage des parties du chapitre attend que le Service Worker CONTRÔLE la page (controllerchange / ready) : avant, déclenché à 1,2 s, il courait avant clients.claim() sur un premier chargement et ses fetch contournaient le SW → rien n'était mis en cache, la partie suivante restait inaccessible hors-ligne ; vérifié en test réel : p4 d'un chapitre navigué en ligne se charge désormais depuis le cache hors connexion. // v4.30 : FIABILITÉ LECTURE (demande propriétaire après tests) — (1) formules posées : une formule de calcul noyée dans une phrase passe sur SA propre ligne côté client (promoteMathLines + .math-line nowrap/scroll), fini les formules coupées en deux par le retour à la ligne mobile ; contenu des 124 fichiers de cours INTACT ; (2) titres d'étape réparés : strong redevient inline, plus de « : » orphelin en début de ligne (830 occurrences corrigées à l'affichage) ; (3) hors-ligne honnête : distinction réseau absent (504/offline → panneau « Pas de connexion » + Réessayer, navigation conservée) et vrai 404 (« bientôt disponible ») ; (4) préchauffage : après l'ouverture d'une partie, les AUTRES parties du chapitre sont mises en cache silencieusement → chapitre entier consultable hors-ligne, navigation instantanée ; (5) les écrans d'erreur remontent la navigation (prev/next/compteur/notes) qui restait masquée pour toujours ; (6) boucle de retry KaTeX plafonnée (30 essais) si le CDN est bloqué ; (7) tutoriel : « Passer le tutoriel » ferme SANS confirmation (le × garde la sienne), 2 sélecteurs invalides réparés (.tools-grid aref→a[href), popup premium sautée après un Passer, tour non lancé sur lecture/exam/exam-history pour ne pas interrompre une lecture ; serveur inchangé. // v4.29 : REFONTE AFFICHAGE DES COURS MATHS (44 fichiers réécrits à la demande du propriétaire) — les formules ne sont plus noyées dans les phrases : toute formule du programme vit dans un bloc dédié sur sa propre ligne (formula-hero pour les majeures, formula-box pour les propriétés, examples + steps pour les calculs), chaque calcul se pose étape par étape (une transformation par ligne), divisions systématiquement parenthésées (1 − q^(n+1))/(1 − q), multiplications marquées ×, tableaux dans chaque partie (propriétés, valeurs remarquables, variations, comparaisons) et GRANDE TABLE DE SYNTHÈSE objet/formule/astuce dans chaque fiche p4 comme la fiche Nombres complexes, figures SVG thémées (courbes avec asymptotes, Venn, arbres pondérés, nuages de points + droite d'ajustement, familles de solutions) — densité contrôlée automatiquement (≥ 2 hero, ≥ 2 box, ≥ 1 table, ≥ 16 étapes en p1-p3 / 12 en p4, ≥ 2 SVG par chapitre) : standard calibré sur nombres_complexes qui passe 0 violation. Contenu du programme inchangé, calculs re-vérifiés (dont vérification symbolique sympy sur équations différentielles) ; exercice type Bac équations différentielles corrigé (P' = −0,05·P + 20 → P(t) = 400 + 600e^(−0,05t), lim 400). Cache-manifest régénéré (126 fichiers). v4.28 : COURS MATHS COMPLETS — les 11 chapitres du programme de Mathématiques Terminale D sont intégrés (44 fichiers de cours : 4 parties par chapitre, ~22 300 lignes) : nombres complexes (forme algébrique, conjugué/module/argument, formes trigono-exponentielles, fiche Moivre/Euler/équations/géométrie), similitudes planes directes, calcul de probabilités (conditionnement, totales, Bayes, indépendance), variable aléatoire (espérance/variance, binomiale, normale), fonctions numériques (limites/continuité/bijection/dérivées), logarithme népérien, fonction exponentielle, calcul intégral (primitives, intégrales, IPP, aires), équations différentielles (y'=ay, ay+b, ay+f(x), radioactivité), suites numériques (arithmétique/géométrique/arithmético-géométrique, convergence, récurrence), statistiques (indicateurs, ajustement linéaire, corrélation). Même format que SVT : hero/sommaire/notions/QCM dépliables/fiches, symbolisme 100 % Unicode en span.math (zéro KaTeX cassé, zéro antislash), classes lecture-* thémées clair+sombre, calculs purs vérifiés + contexte nigérien ; ancien pilote nombres_complexes/p1.html réécrit au format standardisé. Cache-manifest régénéré (126 fichiers) pour la lecture hors-ligne de tout le cours de Maths. v4.27 : COURS SVT COMPLETS — les 20 chapitres du programme de SVT Terminale D sont intégrés (80 fichiers de cours : 4 parties par chapitre) : notion de l'IG, ADN, reproduction conforme (réplication/mitose), cycle cellulaire, protéines, synthèse des protéines, reproduction sexuée (méiose), brassage des gènes, transmission des caractères (hérédité humaine), anomalies chromosomiques, tissus nerveux/réflexes, messages nerveux, glycémie, appareils génitaux, régulation hormonale, fécondation/nidation, régulation des naissances, soi/non-soi, réponses immunitaires, VIH/SIDA. Format identique au pilote maths (hero, sommaire, notions, callouts, QCM dépliables, fiche de révision), symbolisme 100 % Unicode en span.math (zéro KaTeX cassé), styles uniquement via les classes lecture-* déjà thémées (mode clair ET sombre lisibles), ~38 000 lignes pédagogiques avec contexte nigérien ; cache-manifest.json régénéré (83 fichiers) pour la lecture hors-ligne de tout le cours de SVT. // v4.26 : KATEX FLÈCHES + FORMULAIRES × NOUVELLE BASE + MODE CLAIR LISIBLE — (1) FIX « ADN\to ARN » : les pipelines serveur exam/reviseur/progress convertissaient les flèches Unicode (→) en \to PARTOUT, y compris HORS des $…$, et le wrapping orphelin sautait dès qu'un $ existait ailleurs dans la chaîne → le \to restait affiché en texte brut dans les phrases. Pipelines désormais segment-aware : les maths $…$ reçoivent Unicode→LaTeX (plus d'erreurs KaTeX sur $x → 3$), la prose garde les flèches Unicode lisibles (→, ⇒, ⇔), les \to/->/=> orphelins hors maths sont convertis en Unicode, le wrapping orphelin passe en inline $…$ (les \begin{} restent display) et ne saute plus à cause d'un $ ailleurs. (2) katex-utils.js v5.1 : filet de sécurité client — replaceUnicodeMath inversé (Unicode→LaTeX DANS les maths) + fixOrphanArrows (flèches LaTeX/ASCII orphelines → Unicode) branché dans renderMath (répare AUSSI le contenu déjà stocké en Firestore) et cleanLatexText. (3) FORMULAIRES régénérés sur la NOUVELLE base de chapitres (57 chapitres : maths 11, physique 17, chimie 9, svt 20) : 218 formules (avant 162) — 122 anciennes remappées vers leurs chapitres, 40 hors-programme retirées (coniques, produit vectoriel, géométrie espace, optique lentilles, cinétique/redox/piles chimie, géologie) et 96 nouvelles rédigées (SVT 10→54 : notion IG, structure ADN, réplication, cycle cellulaire, protéines, transcription/traduction ADN→ARNm→protéine, méiose, brassage, Hardy-Weinberg, anomalies, réflexes, potentiel d'action, glycémie, gamétogenèses, axe hypothalamo-hypophysaire, nidation, contraception, CMH, groupes ABO, réponses humorale/cellulaire, VIH) ; favoris pointant vers des formules retirées auto-purgés (pruneFavorites) ; test rendu réel 218/218 sans erreur KaTeX (katex.min.js). (4) MODE CLAIR LISIBLE : ~190 corrections de contraste sur 31 fichiers — 3 modales/fonds sombres en dur passés aux variables (exam-history, reviseur-history, auth-choice .preview), popup premium dupliqué sur 6 pages var-based, tableau périodique lisible en clair (10 catégories assombries), mathmind (textes crème → tokens), blocs rgba(0,0,0,.15-.4) → var(--block-bg), pastels illisibles → tokens (success-light/danger-light/accent-purple/warning-bright), boutons or : var(--on-gold), nouveaux tokens --block-bg/--on-gold/--accent-purple/--shimmer, perf.css html background var-based. Tests : 28/28 pipelines flèches (exam/reviseur/progress/katex-utils réels extraits) + 218/218 formules KaTeX + node --check toutes pages modifiées. // v4.25 : ONBOARDING PROPRE — auth-choice.html (porte d'entrée des nouveaux) : boutons pré-réglage mode clair/sombre (🌙/☀️, ARVEXA_THEME) et langue FR/EN (ARVEXA_LANG) dans le header desktop + encart « Avant de commencer, réglez vos préférences » visible sur mobile, mêmes mécanismes que profil.html (localStorage + sync multi-onglets), +5 clés i18n EN ; l'utilisateur arrive dans l'app avec ses préférences déjà appliquées. // v4.24 : BANDEAU NOTIFS UNIVERSEL 12H — le bandeau d'activation est visible aussi par ceux qui ont REFUSÉ (icône 🔕, titre « Notifications désactivées », instructions « Réglages → Applications → Chrome ou ARVEXA → Notifications », bouton Réessayer) ; relance automatique au retour sur l'app (visibilitychange) et toutes les 12h pendant une session (installFcmRecurring) ; « Plus tard » conserve la pause 12h ; objectif : faire monter le taux 9/36 élèves notifiables. // v4.23 : ANTI-DOUBLON FINAL — tag unique par envoi (webpush.notification.tag : les doublons multi-comptes/multi-origines s'écrasent silencieusement) + firebase-messaging-sw.js v1.2 skipWaiting (le SW à jour s'active immédiatement chez l'utilisateur) // v4.22 : ANTI-DOUBLON notifications — le payload notification natif est affiché par le SDK FCM une seule fois, le SW n'affiche plus que les messages data-only (firebase-messaging-sw.js C4) // v4.21 : NOTIFICATIONS FIABLES — banner FCM re-proposé toutes les 12h (au lieu de 3j) pour que chaque élève active les notifications // v4.20 : MENUS IDENTIQUES À L'INDEX (le user : « ajoute les éléments manquants dans les menus des autres pages, les menus doivent être identiques à celles de l'index »). (1) profil.html, abonnement.html, notifications.html : sidebar passée de 4 à 8 items — ajout Arv-progress (fa-graduation-cap), Outils (fa-toolbox) et « Donner mon avis » (fa-star, style doré avis-link + CSS) dans le MÊME ORDRE que index : Accueil, Mon profil, Mon abonnement, Notifications, Arv-progress, Outils, Donner mon avis, Déconnexion ; item actif conservé par page ; handlers logout intacts. (2) « Donner mon avis » hors index pointe vers index.html?avis=1 et index auto-ouvre la modale Avis existante (étoiles/catégorie/message → Firestore + Telegram) quand ?avis=1 — une seule source de vérité pour le formulaire, zéro duplication ; l'URL est nettoyée via history.replaceState après ouverture. (3) mathmind.html (jeu) : section « ARVEXA School » ajoutée dans la sidebar sous le Grand Mix — les 7 liens standard (dont Donner mon avis) + 5 symboles SVG tracés (i-user, i-crown, i-bell, i-tool, i-grad) dans le style du jeu ; la nav du jeu (Tableau de bord/Chapitres/Bibliothèque/Progression/Grand Mix) est intacte, les nouveaux liens ne portent pas data-nav (non interceptés par le routeur) ; Déconnexion absente (page sans auth, progression locale). (4) arv.html (chat) : section Navigation entre l'historique des conversations et le pied de sidebar — les 7 liens + Déconnexion (signOut déjà importé → auth-choice.html, même destination que le reste de l'app) ; CSS .sidebar-nav-x compacte ; l'historique des conversations (flex:1) absorbe la hauteur. Pages de détail (chapitre, exam, matiere...) : inchangées par conception (bouton retour, pas de menu). Tests : 173/173 test_menus_v420.js (8 items/ordre/icônes/CSS par page, handler ?avis=1, symboles mathmind, nav jeu intacte, chat intact, ids uniques, nav équilibrées) + 53/53 v4.18 ; les autres suites (exam/API) ne touchent aucune page modifiée. // v4.19 : EXAM — 100% DES CALCULS, ZÉRO HISTOIRE (le user : « tu donnes des problèmes, c'est juste des calculs pas autre, comme avant ») : malgré v4.17, 6 fuites narratives subsistaient. (1) L'offre « Situation réelle FACULTATIVE (1 exercice max) » était systématiquement prise par l'IA à température 1.0 → SUPPRIMÉE : sciences = 3 exercices sur 3 en CALCULS PURS, l'énoncé DONNE l'expression/l'équation/le bloc « Données : », STRICTEMENT INTERDIT de raconter une histoire (marché, trajet, forage, tontine cités comme interdits) + anti-exemple explicite (« ET PAS : Aïcha achète au marché... »). (2) Exemples few-shot Pascal Lainé injectés dans chaque prompt sciences (maths : z = (3+6i)/(-3-4i) → forme algébrique puis module/argument ; physique : x_M(t) = 40 - 4t et x_C(t) = 10 + t² → instant de rencontre). (3) PHYSICS_RULES : « situation technique COURTE (ex: un motard rattrape un camion) » remplacée par DONNÉES TECHNIQUES DIRECTES (équations horaires, valeurs v0/a/U/R/m, 1 phrase de cadrage neutre max). (4) DIFFICULTY_RULES bac : exemple physique réécrit en forme données→calcul (x_M(t) = -30t + 0,3t² / x_C(t) = 20t + 40), typo « Pascal Laine » corrigée. (5) PEDAGOGY_RULES : « Réalistes » (poussait au récit) remplacé par « Fidèles au programme ». (6) LE POOL examPool RECONTAMINAIT les générations : les exercices narratifs archivés AVANT v4.19 ressortaient via le rattrapage near-miss ET la reconstruction totale — désormais chaque exercice archivé porte genStyle ('calc' sciences / 'recit' littéraires) et les matières scientifiques ne puisent QUE dans genStyle='calc' (vieux exercices narratifs ignorés ; pool vide → fournisseur suivant ou écran indisponible) ; littéraires : pool et contexte imposé inchangés. La variété v4.16 reste complète (température 1.0, graine TIRAGE N°, tirage de techniques par matière, anti-récyclage avoidStatements). Tests : 70/70 v4.19 (nouveau harnais pool avec stubs Firestore : archivage taggé, rattrapage filtré, reconstruction filtrée, littéraires intacts) + non-régression 49/49 v4.17 + 37/37 v4.16 + 39/39 v4.15 + 21/21 + 25/25 client = 231 vérifications ; node --check exam.js. // v4.18 : v4.18 : Page abonnement complétée — la carte premium n'exposait que 4 avantages ; désormais les 8 avantages RÉELS du système, vérifiés dans le code, en grille compacte : tous les chapitres débloqués (toutes les matières), exercices corrigés, Mode Examen illimité (2/jour en gratuit), ARV Assistant 60 questions/jour (contre 10 en gratuit), Réviseur illimité (fiches, flashcards, quiz — 3/jour en gratuit), Planificateur IA exclusif (programme de révision sur mesure), Cahier ARV-PROGRESS sans limite (cours par photo ou voix, lacunes détectées), historiques d'épreuves et fiches conservés + suivi de progression. Écran « Premium actif » synchronisé (8 items au lieu de 5, « ARV-ASSISTANT illimité » faux retiré) ; libellé erroné « Pose 3 questions/jour à l'IA » corrigé. Aucun changement backend ni de tarifs (2 000 / 18 000 XOF). Tests : 53/53 abonnement v4.18 (grille 8 items, pb-list 8 items, quotas cohérents avec le code, non-régression complète). // v4.17 : DES CALCULS, PAS DES HISTOIRES (référence fiches "Pascal Lainé", capture NOMBRES COMPLEXES envoyée par l'élève) — depuis la v4.16, l'IA IMPOSAIT un contexte nigérien par sujet (marché de Niamey, forage, tontine…) : les maths livraient des PROBLÈMES concrets au lieu de CALCULS purs. Correctif : pour les matières scientifiques (maths, physique, chimie, SVT) le prompt impose désormais le STYLE « des calculs, pas des histoires » — l'exercice DONNE une expression/équation/données techniques et l'élève calcule ; au minimum 2 exercices sur 3 PAR SUJET sont des calculs purs, la situation réelle devient FACULTATIVE (au maximum 1 par sujet) ; la VARIÉTÉ à chaque relance vient désormais du TYPE DE CALCUL tiré au hasard (VARIATION_CALC_DRILLS : mettre sous forme algébrique (3+6i)/(-3-4i), module/argument d'un produit 3i(2+i)(4+2i)(1+i), puissances élevées ((1+i√3)/2)^{2010}, équations, limites/dérivées, suites, probabilités, vecteurs — 6-8 techniques par matière) + un angle de calcul (VARIATION_CALC_ANGLES : « montrer que… », vérification croisée, résultat de a qui sert à b…), la température créative 1.0 et l'anti-récyclage v4.16 restent actifs. Difficulté calibrée en EXEMPLES DE CALCULS du niveau exigé (facile : (3+6i)/(-3-4i) → BAC : z^4+(3-6i)z^2-8-6i=0) — « en fonction de la difficulté ça change, ça va varier ». Physique : situation technique COURTE (1-2 phrases) puis calcul immédiat. Matières littéraires (philosophie/histoire/géo) : contexte imposé conservé, inchangé. Aucun changement d'interface (100% serveur). Tests : 49/49 v4.17 + non-régression 37/37 + 39/39 + 21/21 + 25/25 (171 vérifications, fonctions réelles en vm). // v4.16 : à chaque relance, des exercices TOTALEMENT différents (fini les sujets qui se ressemblent d'une génération à l'autre) — 3 causes corrigées en même temps. (1) Température IA de GÉNÉRATION passée de 0,3 à 1,0 : à 0,3 les réponses étaient quasi déterministes, le même prompt ressortait avec les mêmes trames d'exercices ; la CORRECTION garde 0,3 pour une notation stable. (2) Tirage aléatoire injecté dans CHAQUE prompt de génération : graine unique (TIRAGE N°), contexte nigérien imposé par matière (marché de Niamey, forage villageois, tontine, élevage, motard sur la route de Filingué, dosage de vinaigre… 15 contextes communs + 5-6 par matière sur les 7 matières), approche pédagogique imposée (estimer avant de calculer, donnée superflue à écarter, comparaison de deux situations, question de synthèse… 8) et contrainte imposée (valeurs NON RONDES, décimales + fraction, notation scientifique — ou contrainte rédactionnelle pour philosophie/histoire/géo). (3) Anti-récyclage personnel : l'application mémorise en local (localStorage, 3 dernières épreuves) les énoncés déjà générés et les envoie au serveur à chaque relance (avoidStatements) — le serveur les assainit (18 max, 140 car) et les interdit à l'IA : reprendre un énoncé tel quel ou en changer seulement les nombres = refusé. Bonus : le rattrapage pool (v4.15) tire désormais l'exercice de secours AU HASARD parmi les candidats du même niveau (avant : toujours le premier de la liste → répétitions mécaniques). Aucun changement d'interface. Tests : 37/37 serveur + 21/21 client (fonctions réelles extraites en vm : températures 1,0 génération / 0,3 correction, graines toutes différentes sur 50 appels, assainissement avoid complet, tirages pool variés, mémo 3 générations filtré par matière, câblage generateExam complet) + non-régression v4.15 39/39 + 25/25 + balayage 390×844 (3 vues × 0 débordement). v4.15 : l'exam reçoit la technique du cahier (v4.13) — FINI les erreurs pour rien : le serveur renvoie retryAfter sur 429 et le client (examFetch) affiche un COMPTE À REBOURS automatique « Beaucoup d'élèves — nouvel essai dans Xs… » puis RETENTE TOUT SEUL (une re-tentative ; panne réseau → re-tentative discrète à 2,5 s ; quota FREE → popup premium inchangée). Serveur : génération/correction lourdes 3→5/min (une classe entière derrière une IP partagée CGNAT n'est plus bridée à 3 essais ; le quota Groq reste protégé), buckets léger/lourd inchangés. L'IA est FORCÉE de livrer les résultats complets : contrat de complétion dans les 3 prompts (30/30 questions, énoncés NON VIDES, vérification finale avant réponse, jamais partiel), gradation obligatoire Sujet 1→Sujet 2 (le sujet 2 doit être visiblement plus difficile), validation stricte — une question sans énoncé est rejetée (avant : affichée VIDE à l'élève !) — et rattrapage « presque complet » : si l'IA livre ≤3 questions vides, l'exercice fautif est remplacé par un exercice équivalent du pool d'exercices puis revalidé strictement (marqueur +pool), sinon fournisseur suivant. Anti-débordement renforcé sur exam.html (technique cahier v4.10) : .question-title span, .statement, .answer-option span, .subject-card, .grade-*, et l'en-tête d'exercice .exercise-head (flex-wrap + titre à retour à la ligne forcé — le badge « 6.67 points · 5 questions » ne sort plus de l'écran sur les titres à mots interminables). Tests : 39/39 serveur (vm — buckets 5/min isolés, validation stricte, near-miss, patch pool, prompts complets, retryAfter) + 25/25 client (examFetch réel extrait : compte à rebours, 2×429→RATE_LIMIT, FREE limit sans re-tentative, réseau instable, plafond 65 s) + balayage 390×844 pire-cas (mots longs, U+00A0, KaTeX, options interminables, dessin, feedbacks) : 3 vues × 0 débordement après fix exercise-head. v4.14 : QCM du cahier retiré (affichage ET génération) — c'était la zone qui débordait sur mobile ; chaque section livre désormais l'explication du prof + la banque de questions Q/R, sans le bloc QCM interactif. La tâche IA 'qcm' est supprimée des 6 générateurs de prompts (gain ~13 s et du quota Groq par section, 4 tâches au lieu de 5) ; les anciennes sections gardent leur QCM en base (invisible) ; badge « N QCM » de la liste de sections et étape « QCM » de l'écran de génération retirés. renderQcm/CSS conservés dans le fichier (inertes) pour une réactivation éventuelle. Tests : 6/6 rendu (aucun QCM affiché même avec 12 QCM en entrée, explication + questions + structure intactes) + 3/3 serveur (aucune tâche qcm sur les 6 profils). v4.13 : fin des faux « trop de demandes » — les compteurs de débit (rate-limit) étaient PARTAGÉS entre toutes les actions d'un même IP : une navigation normale (dashboard, heartbeat d'étude, lectures) remplissait le compteur global et la 1re suppression de section (sans IA) héritait d'un « trop de tentatives » injustifié. Fix : un bucket indépendant par (IP, action) sur /api/progress, buckets séparés léger/lourd sur /api/exam et /api/reviseur, limites relevées pour les actions sans IA (tuteur 15→25/min, historique 30→40/min, planificateur 12→15/min), balayage mémoire anti-fuite. Côté client : retente silencieuse (1,5 s) sur 429 pour les 9 actions légères du cahier — l'élève ne voit plus de message pour une suppression ou une lecture ; messages 429 unifiés et calmes (« Service momentanément saturé… » / « Beaucoup d'élèves en ce moment… »), fini « Trop de tentatives » agressif. Tests : 12/12 unitaires serveur (trafic mixte 110 requêtes puis 10 suppressions → aucune bloquée) + 5/5 client (retry silencieux, quota FREE préservé) + balayage overflow 390×844 (repro QCM 0 débordement, 7 pages propres). v4.12 : notification SW_ACTIVATED post-claim (détection de mise à jour sans course) + propagation fiable — propagation fiable des mises à jour — les pages HTML passent en NETWORK-FIRST (réseau d'abord avec garde-fou 2,5 s → repli cache ; appareil hors ligne déclaré → cache instantané ; le fetch de fond continue de rafraîchir le cache même après un repli) pour que chaque correction déployée arrive sur les téléphones dès la 1re ouverture, même après des jours de PWA ouverte ; precache avec timeout 8 s par URL (fini les installations qui pendent en réseau instable et retardent skipWaiting) ; toast « Nouvelle version installée » dans register-sw (clic = application immédiate). Cause racine : stale-while-revalidate servait l'ancien HTML indéfiniment quand la revalidation d'arrière-plan échouait (réseau 3G instable), d'où « c'est pas réglé » malgré des fixs déployés. v4.11 : écran maintenu allumé pendant les générations IA — wake-lock.js (Wake Lock natif Android/iOS + repli vidéo muette NoSleep pour navigateurs anciens, compteur de références multi-générations, ré-acquisition au retour d'arrière-plan) intégré aux pages arv, exam (génération + correction), reviseur, reviseur-history, exam-history, planificateur et arv-progress ; wake-lock.js precaché. v4.10 : fix QCM « le test sort de sa zone » — les options longues débordaient hors de l'écran (espaces insécables U+00A0 émis par l'IA → texte insécable + span flex sans min-width:0). Fix triple : serveur cleanLatexText normalise U+00A0/U+202F en espaces normaux sur TOUTE l'analyse ; cahier safeText normalise à l'affichage (sections déjà stockées réparées) + CSS .qcm-option (flex-start, min-width:0, span break-word) ; exam .answer-option/.question-title idem. v4.9 : fix UI — modales formulaire (détail d'une formule) et notifications : haut en dôme géant (border-radius 999px) → arrondi normal 20px comme les autres pages. v4.8 : dictée vocale v3 — anti-répétitions (fusion sans chevauchement des segments que le moteur re-transcrit après chaque relance + compression des bégaiements « le le »), cap recalibré 2 500 caractères (budget IA). v4.7 : dictée vocale reconstruite — flux 2 étapes scrollables dans « Ajouter une section » (étape 1 texte centré → étape 2 bouton enregistrer centré), durée illimitée (relance auto), cap 15 000 caractères, aperçu live, erreurs micro explicites. v4.6 : serveur progress v8.6 « édition complète » — explications prof enrichies, banque de questions exhaustive 10-40, QCM 8-12 imposés, anglais ré-ajouté au cahier (toujours sans mode examen), normalisation Q&R/QCM côté serveur. v4.5 : cahier (arv-progress) adapté au serveur progress v8.5 restauré tel quel — actions v9 retirées (progression/goals/sessions/quota/markSectionStudied), rendu contexte+faits clés histoire-géo ; connexion exam (useNotebook) inchangée. // v4.3 : notebook + exam — matière Anglais (cahier, sans mode examen), banque de questions élargie, QCM 8, bouton « Retourner à mon cahier », dictée vocale reconstruite (zéro doublon). v4.2 : réviseur « en dur » — accueil du réviseur peint pré-CDN depuis un snapshot local par chapitre (LRU 12, TTL 12 h), hydratation de l'état (notions incluses), revalidation silencieuse /api/reviseur conservant le cache en cas d'erreur réseau, statut blocked/paused via docSWR (arvexa-cache.js). v4.1 : audit stabilité — precache étendu (JS partagés bac-date/auth-guard/katex-utils/analytics/offline/onboarding-tour/register-fcm-sw/firebase-messaging-sw + pages auth-choice/login/404) pour un offline fiable dès l'installation. v4.0 : // v4.0 : accueil « en dur » — tableau de bord restauré pré-CDN depuis les caches locaux (countdown BAC, date/citation du jour, compteurs de lecture, badges), splash épuré (nom du site + cercle), anti-flash instant/ready. v3.9 : cache-first universel — arvexa-cache.js (readCacheDoc/docSWR : lecture cache IndexedDB Firestore instantanée + revalidation serveur arrière-plan), appliqué à arv, arv-progress, exam, exam-history, reviseur-history, tableau-periodique, formulaires ; préchauffage 1×/session dans l'index (matières+chapters+notifications). v3.8 : accueil instantané — splash 1er chargement de session + snapshot de session (retour accueil sans rechargement visible, pill de synchro). v3.8 : accueil instantané — splash de chargement au 1er chargement de session uniquement (#appSplash), snapshot de session pour restaurer l'accueil sans rechargement visible (Firestore actualise en arrière-plan + pill discrète). v3.7 : couverture i18n complète — +228 clés (abonnement, légal, examens, badges, toasts, titres de pages), apostrophes unifiées dans norm(), motifs Niveau/Partie/session/badges/mois, titres <title> ajoutés aux pages. v3.6 : bilingue FR/EN — arvexa-i18n.js (dictionnaire + MutationObserver + persistance 'arvexa-lang' + sync multi-onglets), sélecteur Langue dans profil.html. Précédent v3.5 : : mode clair global — tokens [data-theme=light] dans arvexa-ui.css, theme.js (persistance + meta theme-color + sync multi-onglets), boot anti-flash inline sur toutes les pages, couleurs codées en dur thémables (rgb triplets), toggle Apparence dans profil.html 4affefe (v4.26 : COURS SVT COMPLETS — 20 chapitres × 4 parties (80 fichiers, ~38 000 lignes) : IG, ADN, mitose/réplication, cycle cellulaire, protéines, synthèse protéines, méiose, brassage, hérédité humaine, anomalies chromosomiques, système nerveux, messages nerveux, glycémie, appareils génitaux, régulation hormonale, fécondation/nidation, régulation des naissances, soi/non-soi, réponses immunitaires, VIH/SIDA. Format pilote maths (hero/sommaire/QCM/fiches), math Unicode span.math (zéro KaTeX cassé), classes lecture-* thémées clair+sombre, contexte nigérien. Cache-manifest régénéré (83 fichiers) pour offline.)
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_HTML = `${SW_VERSION}-html`;
// Garde-fous réseau : les HTML attendent le réseau au max HTML_NET_TIMEOUT avant de
// retomber sur le cache (fraîcheur garantie en ligne, réactivité préservée hors ligne).
const HTML_NET_TIMEOUT = 2500;
const PRECACHE_TIMEOUT = 8000;

// ⚡ Toutes les pages HTML de l'app pour précache complet
const PRECACHE = [
  './',
  './index.html',
  './matiere.html',
  './chapitre.html',
  './lecture.html',
  './profil.html',
  './reviseur.html',
  './exam.html',
  './exam-history.html',
  './abonnement.html',
  './notifications.html',
  './outils.html',
  './formulaires.html',
  './planificateur.html',
  './tableau-periodique.html',
  './arv-progress.html',
  './offline.html',
  './manifest.json',
  './perf.css',
  './arvexa-ui.css',
  './theme.js',
  './arvexa-i18n.js',
  './arvexa-cache.js',
  './register-sw.js',
  './arvexa-confirm.js',
  './wake-lock.js',
  './icon.png',
  // v4.1 — offline fiable dès l'installation : JS partagés + pages d'auth
  './bac-date.js',
  './auth-guard.js',
  './katex-utils.js',
  './analytics.js',
  './offline.js',
  './onboarding-tour.js',
  './register-fcm-sw.js',
  './firebase-messaging-sw.js',
  './auth-choice.html',
  './login.html',
  './404.html'
];

// Ne JAMAIS intercepter
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'firebasestorage.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com'
];

const NEVER_CACHE_PREFIXES = ['/api/'];

// ═══ INSTALL ═══
// Chaque URL du precache est bornée dans le temps (PRECACHE_TIMEOUT) : en réseau
// instable, l'installation ne peut plus pendre des minutes et retarder skipWaiting.
function precacheOne(cache, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PRECACHE_TIMEOUT);
  return fetch(new Request(url, { signal: ctl.signal }))
    .then((response) => {
      if (response && response.ok) return cache.put(url, response);
      console.warn('[SW] Précache ignoré :', url);
    })
    .catch(() => {
      console.warn('[SW] Précache ignoré :', url);
    })
    .finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  console.log(`[SW] Install ${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => Promise.all(PRECACHE.map((url) => precacheOne(cache, url))))
      .then(() => self.skipWaiting())
  );
});

// ═══ ACTIVATE ═══
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activate ${SW_VERSION}`);
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(SW_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
    .then(() => self.clients.matchAll())
    .then((clients) => clients.forEach((client) =>
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION })
    ))
  );
});

// ═══ FETCH ═══
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(handleHTML(req));
    return;
  }

  if (
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'font' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(handleStatic(req));
    return;
  }

  if (req.destination === 'image') {
    event.respondWith(handleImage(req));
    return;
  }

  event.respondWith(handleGeneric(req));
});

// ═══ STRATÉGIES ═══

// 🔄 HTML : NETWORK-FIRST avec garde-fou (remplace stale-while-revalidate)
// En ligne → le réseau d'abord : chaque page servie est LA version déployée,
// les correctifs arrivent sur les téléphones dès la première ouverture.
// Appareil hors ligne déclaré → cache instantané (zéro latence).
// Réseau lent/échoué → cache sous HTML_NET_TIMEOUT, puis le fetch continue
// en tâche de fond pour rafraîchir le cache de la prochaine fois.
function offlineFallback(req) {
  return caches.open(CACHE_STATIC)
    .then((staticCache) => staticCache.match(req, { ignoreSearch: true }))
    .then((cachedStatic) => {
      if (cachedStatic) return cachedStatic;
      return caches.match('./offline.html');
    })
    .then((offline) => {
      if (offline) return offline;
      return new Response(
        '<!DOCTYPE html><html lang="fr"><body><h1>Hors ligne</h1><p>Page non disponible.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    });
}

async function handleHTML(req) {
  const cache = await caches.open(CACHE_HTML);
  // ✅ v4.31 — ignoreSearch : la navigation hors-ligne « /lecture.html?subject=… »
  // doit retrouver le cache « /lecture.html » (sans query, le match échouait
  // et l'élève tombait sur offline.html alors que la page EST en cache)
  const cached = await cache.match(req, { ignoreSearch: true });

  // Mode avion / pas de connectivité déclarée → cache direct
  if (self.navigator && self.navigator.onLine === false && cached) return cached;

  // La promesse réseau vit au-delà du garde-fou : si elle aboutit après un
  // repli sur cache, elle rafraîchit quand même le cache pour la prochaine fois.
  const netPromise = fetch(req)
    .then((response) => {
      if (response && response.ok) cache.put(req, response.clone());
      return response;
    })
    .catch(() => null);

  let served = null;
  try {
    served = await Promise.race([
      netPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('HTML_NET_TIMEOUT')), HTML_NET_TIMEOUT)
      ),
    ]);
    if (served) return served;
  } catch (e) {
    // réseau trop lent → repli cache ci-dessous
  }

  if (cached) return cached;

  // Pas de cache (première visite) : laisser le fetch initial une vraie chance
  try {
    served = await netPromise;
    if (served) return served;
  } catch (e) {}

  return offlineFallback(req);
}

// ⚡ Static : stale-while-revalidate (déjà correct)
async function handleStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req, { ignoreSearch: true });

  const fetchPromise = fetch(req)
    .then((response) => {
      if (response && response.ok) cache.put(req, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response('', { status: 504 });
}

async function handleImage(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response && response.ok) cache.put(req, response.clone());
    return response;
  } catch (e) {
    return new Response('', { status: 204 });
  }
}

async function handleGeneric(req) {
  const cache = await caches.open(CACHE_HTML);
  try {
    const response = await fetch(req);
    // ✅ v5-PDF — ne mettre en cache que les GET : une réponse HEAD (sans corps)
    // ne doit jamais écraser l'entrée GET d'une même URL (sonde de disponibilité
    // des PDF de cours — match() ignore la méthode, le GET retrouvera le PDF).
    if (response && response.ok && req.method === 'GET') cache.put(req, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || new Response('', { status: 504 });
  }
}

// ═══ HANDLERS MESSAGE ═══
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'DOWNLOAD_ALL' && Array.isArray(data.files) && port) {
    downloadAllFiles(data.files, port);
  }

  if (data.type === 'CACHE_URL' && data.url) {
    cacheUrl(data.url);
  }

  if (data.type === 'STATS' && port) {
    getStats(port);
  }
});

async function downloadAllFiles(files, port) {
  const total = files.length;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const url = files[i];
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        const cache = await caches.open(CACHE_HTML);
        await cache.put(url, response);
        done++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }

    const percent = Math.round(((done + failed) / total) * 100);
    port.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      done, failed, total, percent
    });
  }

  port.postMessage({
    type: 'DOWNLOAD_COMPLETE',
    done, failed, total
  });
}

async function cacheUrl(url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response.ok) {
      const cache = await caches.open(CACHE_HTML);
      await cache.put(url, response);
    }
  } catch (e) {}
}

async function getStats(port) {
  try {
    const names = await caches.keys();
    const stats = {};
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      stats[name.replace(`${SW_VERSION}-`, '')] = keys.length;
    }
    port.postMessage({ type: 'STATS_RESULT', stats });
  } catch (e) {
    port.postMessage({ type: 'STATS_RESULT', stats: {} });
  }
}

console.log(`[SW] ${SW_VERSION} prêt — navigation instantanée active`);
