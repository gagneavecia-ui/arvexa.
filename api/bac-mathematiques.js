// ================================================================
// BASE DE CONNAISSANCES — BAC MATHÉMATIQUES
// Terminale D · Niger
// Version : 1.0.0
// Source de vérité : garantit que 100% des notions obligatoires
// sont couvertes par les fiches, quiz et exercices générés.
// ================================================================

const BAC_MATHEMATIQUES = {
  matiere: 'mathematiques',
  matiereLabel: 'Mathématiques',
  niveau: 'terminale_d',
  pays: 'niger',
  exam: 'bac',
  version: '1.0.0',
  derniereMaj: '2026-01-15',

  chapitres: [
    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 1 — NOMBRES COMPLEXES (14 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'nombres_complexes',
      numero: 1,
      titre: 'Nombres complexes',
      description: 'Étude algébrique et géométrique des nombres complexes.',
      notions: [
        {
          id: 'forme_algebrique',
          titre: 'Définition et forme algébrique',
          description: 'Un nombre complexe s\'écrit z = a + bi où a, b sont réels et i² = -1.',
          formules: ['z = a + bi', 'i^2 = -1', 'a = \\Re(z)', 'b = \\Im(z)'],
          proprietes: [
            'Deux complexes sont égaux si et seulement si leurs parties réelles et imaginaires sont égales',
            'Un complexe est réel si sa partie imaginaire est nulle',
            'Un complexe est imaginaire pur si sa partie réelle est nulle'
          ],
          methodes: [
            'Identifier la partie réelle et la partie imaginaire',
            'Écrire la forme algébrique d\'une expression',
            'Résoudre une égalité de complexes'
          ],
          erreurs_frequentes: [
            'Confondre i² et i',
            'Oublier que i² = -1',
            'Écrire z = ab au lieu de z = a + bi'
          ],
          pieges_examen: [
            'Piège classique : la multiplication (a+bi)(c+di) nécessite de développer les 4 termes'
          ]
        },
        {
          id: 'egalite_complexes',
          titre: 'Égalité de deux nombres complexes',
          description: 'Deux nombres complexes sont égaux si leurs parties réelles et imaginaires sont égales.',
          formules: ['a + bi = c + di \\iff a = c \\text{ et } b = d'],
          proprietes: [
            'Permet de résoudre des équations complexes',
            'Utilisée pour identifier des coefficients'
          ],
          methodes: [
            'Identifier les parties réelles de chaque côté',
            'Identifier les parties imaginaires de chaque côté',
            'Résoudre le système obtenu'
          ],
          erreurs_frequentes: [
            'Oublier une des deux égalités',
            'Confondre signes'
          ],
          pieges_examen: [
            'Bien séparer la partie réelle ET la partie imaginaire'
          ]
        },
        {
          id: 'conjugue',
          titre: 'Conjugué d\'un nombre complexe',
          description: 'Le conjugué de z = a + bi est z̄ = a - bi.',
          formules: ['\\bar{z} = a - bi', 'z + \\bar{z} = 2a', 'z \\cdot \\bar{z} = a^2 + b^2'],
          proprietes: [
            'Le conjugué du conjugué est le nombre lui-même',
            'Le conjugué d\'un produit est le produit des conjugués',
            'Le conjugué d\'une somme est la somme des conjugués'
          ],
          methodes: [
            'Écrire le conjugué en changeant le signe de la partie imaginaire',
            'Utiliser z × z̄ = |z|² pour simplifier'
          ],
          erreurs_frequentes: [
            'Oublier de changer le signe',
            'Confondre conjugué et opposé'
          ],
          pieges_examen: [
            'Le conjugué de a + bi est a - bi (attention au signe du i)'
          ]
        },
        {
          id: 'module',
          titre: 'Module d\'un nombre complexe',
          description: 'Le module de z = a + bi est la distance du point d\'affixe z à l\'origine.',
          formules: [
            '|z| = \\sqrt{a^2 + b^2}',
            '|z_1 z_2| = |z_1| \\cdot |z_2|',
            '\\left|\\frac{z_1}{z_2}\\right| = \\frac{|z_1|}{|z_2|}',
            '|z|^2 = z \\cdot \\bar{z}'
          ],
          proprietes: [
            '|z| ≥ 0',
            '|z| = 0 si et seulement si z = 0',
            '|z̄| = |z|',
            '|z_1 + z_2| ≤ |z_1| + |z_2| (inégalité triangulaire)'
          ],
          methodes: [
            'Calculer a² + b² puis prendre la racine carrée',
            'Utiliser |z|² = z × z̄ pour éviter les racines',
            'Factoriser le module dans les produits'
          ],
          erreurs_frequentes: [
            'Confondre |z| et |z|²',
            'Oublier la racine carrée',
            'Faire |z_1 + z_2| = |z_1| + |z_2|'
          ],
          pieges_examen: [
            'L\'inégalité triangulaire est une inégalité, pas une égalité (sauf cas particuliers)'
          ]
        },
        {
          id: 'argument',
          titre: 'Argument d\'un nombre complexe',
          description: 'L\'argument de z est l\'angle entre l\'axe des réels et le vecteur d\'affixe z.',
          formules: [
            '\\arg(z) = \\theta \\text{ tel que } \\cos\\theta = \\frac{a}{|z|} \\text{ et } \\sin\\theta = \\frac{b}{|z|}',
            'z = |z|(\\cos\\theta + i\\sin\\theta)'
          ],
          proprietes: [
            'arg(z_1 z_2) = arg(z_1) + arg(z_2) [2π]',
            'arg(z_1 / z_2) = arg(z_1) - arg(z_2) [2π]',
            'arg(z̄) = -arg(z) [2π]',
            'arg(-z) = arg(z) + π [2π]'
          ],
          methodes: [
            'Utiliser arctan(b/a) en ajustant selon le quadrant',
            'Utiliser les valeurs remarquables (π/6, π/4, π/3, π/2)'
          ],
          erreurs_frequentes: [
            'Ne pas ajuster selon le quadrant',
            'Confondre arg et module',
            'Oublier le modulo 2π'
          ],
          pieges_examen: [
            'Valeurs remarquables à connaître : arg(1+i) = π/4, arg(1+i√3) = π/3'
          ]
        },
        {
          id: 'forme_trigonometrique',
          titre: 'Forme trigonométrique',
          description: 'Tout complexe non nul peut s\'écrire z = r(cos θ + i sin θ) avec r = |z|.',
          formules: ['z = r(\\cos\\theta + i\\sin\\theta)', 'r = |z|', '\\theta = \\arg(z)'],
          proprietes: [
            'r > 0',
            'θ est défini modulo 2π',
            'Permet de simplifier les produits et quotients'
          ],
          methodes: [
            'Calculer le module',
            'Calculer l\'argument',
            'Écrire z = r(cos θ + i sin θ)'
          ],
          erreurs_frequentes: [
            'Oublier le r devant la parenthèse',
            'Confondre cos et sin'
          ],
          pieges_examen: [
            'Toujours vérifier r > 0'
          ]
        },
        {
          id: 'forme_exponentielle',
          titre: 'Forme exponentielle',
          description: 'Notation compacte : z = r e^(iθ).',
          formules: ['z = r e^{i\\theta}', 'e^{i\\theta} = \\cos\\theta + i\\sin\\theta'],
          proprietes: [
            'Multiplication : r₁e^(iθ₁) × r₂e^(iθ₂) = r₁r₂ e^(i(θ₁+θ₂))',
            'Division : r₁e^(iθ₁) / r₂e^(iθ₂) = (r₁/r₂) e^(i(θ₁-θ₂))',
            'Puissance : (re^(iθ))^n = r^n e^(inθ)'
          ],
          methodes: [
            'Convertir de forme trigonométrique',
            'Utiliser les propriétés des exponentielles'
          ],
          erreurs_frequentes: [
            'Confondre e^(iθ) et e^x',
            'Oublier le r devant'
          ],
          pieges_examen: [
            'La forme exponentielle est très utile pour les puissances'
          ]
        },
        {
          id: 'operations_complexes',
          titre: 'Opérations sur les formes',
          description: 'Somme, produit, quotient, puissance en formes algébrique et exponentielle.',
          formules: [
            '(a+bi) + (c+di) = (a+c) + (b+d)i',
            '(a+bi)(c+di) = (ac-bd) + (ad+bc)i',
            '\\frac{a+bi}{c+di} = \\frac{(a+bi)(c-di)}{c^2+d^2}'
          ],
          proprietes: [
            'Forme algébrique : addition facile',
            'Forme exponentielle : multiplication et puissance faciles'
          ],
          methodes: [
            'Additionner séparément parties réelles et imaginaires',
            'Multiplier en développant (4 termes)',
            'Pour diviser : multiplier par le conjugué'
          ],
          erreurs_frequentes: [
            'Oublier i² = -1 dans le développement',
            'Mal multiplier le conjugué'
          ],
          pieges_examen: [
            'Utiliser la bonne forme selon l\'opération'
          ]
        },
        {
          id: 'formule_moivre',
          titre: 'Formule de Moivre',
          description: 'Formule pour élever un complexe à une puissance : (cos θ + i sin θ)^n = cos(nθ) + i sin(nθ).',
          formules: ['(\\cos\\theta + i\\sin\\theta)^n = \\cos(n\\theta) + i\\sin(n\\theta)', '(e^{i\\theta})^n = e^{in\\theta}'],
          proprietes: [
            'Valable pour tout entier n',
            'Utile pour calculer cos(nθ) et sin(nθ) en fonction de cos θ et sin θ'
          ],
          methodes: [
            'Écrire le complexe sous forme exponentielle',
            'Appliquer la formule',
            'Reconvertir si nécessaire'
          ],
          erreurs_frequentes: [
            'Oublier le module r',
            'Confondre avec la formule d\'Euler'
          ],
          pieges_examen: [
            'Très utile pour linéariser les expressions trigonométriques'
          ]
        },
        {
          id: 'formules_euler',
          titre: 'Formules d\'Euler',
          description: 'Relation entre exponentielle complexe et fonctions trigonométriques.',
          formules: [
            'e^{i\\theta} = \\cos\\theta + i\\sin\\theta',
            '\\cos\\theta = \\frac{e^{i\\theta} + e^{-i\\theta}}{2}',
            '\\sin\\theta = \\frac{e^{i\\theta} - e^{-i\\theta}}{2i}'
          ],
          proprietes: [
            'Permet de linéariser les puissances de cos et sin',
            'Base de la trigonométrie complexe'
          ],
          methodes: [
            'Utiliser les formules pour transformer cos^n en somme d\'exponentielles',
            'Simplifier puis reconvertir'
          ],
          erreurs_frequentes: [
            'Oublier le 2i dans la formule de sin',
            'Confondre + et -'
          ],
          pieges_examen: [
            'La formule de sin contient 2i (pas 2)'
          ]
        },
        {
          id: 'equation_second_degre',
          titre: 'Équations du second degré dans ℂ',
          description: 'Résolution de az² + bz + c = 0 avec discriminant Δ.',
          formules: [
            '\\Delta = b^2 - 4ac',
            'z = \\frac{-b \\pm \\sqrt{\\Delta}}{2a} \\text{ si } \\Delta \\geq 0',
            'z = \\frac{-b \\pm i\\sqrt{-\\Delta}}{2a} \\text{ si } \\Delta < 0'
          ],
          proprietes: [
            'Toujours 2 solutions dans ℂ (éventuellement confondues)',
            'Somme des racines = -b/a',
            'Produit des racines = c/a'
          ],
          methodes: [
            'Calculer Δ',
            'Si Δ ≥ 0 : racines réelles',
            'Si Δ < 0 : racines complexes conjuguées'
          ],
          erreurs_frequentes: [
            'Oublier le i dans √(-Δ)',
            'Confondre formule réelle et complexe'
          ],
          pieges_examen: [
            'Dans ℂ, √(-Δ) = i√Δ (pas d\'erreur)'
          ]
        },
        {
          id: 'racines_niemes',
          titre: 'Racines n-ièmes',
          description: 'Les racines n-ièmes de l\'unité et d\'un complexe.',
          formules: [
            'z_k = r^{1/n} e^{i(\\theta + 2k\\pi)/n}, \\quad k = 0, 1, ..., n-1',
            '\\text{Racines n-ièmes de l\'unité : } e^{2ik\\pi/n}'
          ],
          proprietes: [
            'Il y a exactement n racines n-ièmes',
            'Les racines sont les sommets d\'un polygone régulier'
          ],
          methodes: [
            'Écrire le complexe sous forme exponentielle',
            'Appliquer la formule',
            'Énumérer les n valeurs de k'
          ],
          erreurs_frequentes: [
            'Oublier des racines',
            'Ne pas vérifier la cohérence géométrique'
          ],
          pieges_examen: [
            'Bien énumérer TOUTES les racines (k de 0 à n-1)'
          ]
        },
        {
          id: 'interpretation_geometrique',
          titre: 'Interprétation géométrique',
          description: 'Affixe, distance, angle dans le plan complexe.',
          formules: [
            'AB = |z_B - z_A|',
            '\\arg(z_B - z_A) = \\text{angle}(\\vec{u}, \\overrightarrow{AB})',
            'z \\text{ est l\'affixe du point } M'
          ],
          proprietes: [
            'Le module représente une distance',
            'L\'argument représente un angle',
            'Permet de résoudre des problèmes de géométrie'
          ],
          methodes: [
            'Identifier les points et leurs affixes',
            'Utiliser module et argument pour distances et angles',
            'Traduire les conditions géométriques en équations complexes'
          ],
          erreurs_frequentes: [
            'Confondre affixe et coordonnées',
            'Mauvais signe dans les différences'
          ],
          pieges_examen: [
            'Bien identifier le point d\'origine du vecteur'
          ]
        },
        {
          id: 'applications_geometriques',
          titre: 'Applications géométriques',
          description: 'Utilisation des complexes pour résoudre des problèmes géométriques.',
          formules: [
            'Alignement : \\frac{z_C - z_A}{z_B - z_A} \\in \\mathbb{R}',
            'Orthogonalité : \\frac{z_C - z_A}{z_B - z_A} \\in i\\mathbb{R}',
            'Cercle : |z - z_0| = r'
          ],
          proprietes: [
            'Un complexe est réel si son argument est 0 ou π',
            'Un complexe est imaginaire pur si son argument est π/2 ou -π/2'
          ],
          methodes: [
            'Traduire la condition géométrique en condition complexe',
            'Simplifier et conclure'
          ],
          erreurs_frequentes: [
            'Ne pas vérifier les cas limites',
            'Oublier le modulo 2π'
          ],
          pieges_examen: [
            'Très utile pour les problèmes de configurations géométriques'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 2 — SIMILITUDES PLANES DIRECTES (7 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'similitudes_planes',
      numero: 2,
      titre: 'Similitudes planes directes',
      description: 'Transformations du plan conservant les angles et multipliant les distances par un rapport constant.',
      notions: [
        {
          id: 'definition_similitude',
          titre: 'Définition d\'une similitude directe',
          description: 'Transformation qui conserve les angles et multiplie les distances par un rapport k > 0.',
          formules: ['\\text{Si } M \\to M\' \\text{ et } N \\to N\', alors } M\'N\' = k \\cdot MN'],
          proprietes: [
            'Conserve les angles orientés',
            'Multiplie les longueurs par un rapport constant',
            'Conserve l\'alignement'
          ],
          methodes: [
            'Vérifier que les angles sont conservés',
            'Vérifier que les distances sont proportionnelles'
          ],
          erreurs_frequentes: [
            'Confondre avec isométrie (k=1)',
            'Oublier que k peut être ≠ 1'
          ],
          pieges_examen: [
            'La similitude est dite directe si elle conserve les angles orientés'
          ]
        },
        {
          id: 'ecriture_complexe',
          titre: 'Écriture complexe (z\' = az + b)',
          description: 'Toute similitude directe s\'écrit z\' = az + b avec a ≠ 0.',
          formules: ['z\' = az + b', 'a \\in \\mathbb{C}^*', 'b \\in \\mathbb{C}'],
          proprietes: [
            'Le rapport de la similitude est |a|',
            'L\'angle est arg(a)',
            'Le centre est le point fixe (si a ≠ 1)'
          ],
          methodes: [
            'Identifier a et b',
            'Calculer le rapport et l\'angle',
            'Trouver le centre'
          ],
          erreurs_frequentes: [
            'Confondre a et b',
            'Oublier que a ≠ 0'
          ],
          pieges_examen: [
            'L\'écriture z\' = az + b est UNIQUE'
          ]
        },
        {
          id: 'rapport_angle',
          titre: 'Rapport et angle',
          description: 'Le rapport est |a| et l\'angle est arg(a).',
          formules: ['k = |a|', '\\theta = \\arg(a)'],
          proprietes: [
            'k > 0',
            'θ est défini modulo 2π'
          ],
          methodes: [
            'Calculer le module de a',
            'Calculer l\'argument de a'
          ],
          erreurs_frequentes: [
            'Confondre k et θ',
            'Oublier de calculer le module correctement'
          ],
          pieges_examen: [
            'Vérifier que |a| est bien le rapport de similitude'
          ]
        },
        {
          id: 'centre_similitude',
          titre: 'Centre d\'une similitude',
          description: 'Point fixe de la transformation z\' = az + b, si a ≠ 1.',
          formules: ['\\omega = \\frac{b}{1-a}'],
          proprietes: [
            'Unique si a ≠ 1',
            'N\'existe pas si a = 1 (translation)'
          ],
          methodes: [
            'Résoudre ω = aω + b',
            'Utiliser la formule ω = b/(1-a)'
          ],
          erreurs_frequentes: [
            'Oublier le cas a = 1',
            'Erreur de calcul'
          ],
          pieges_examen: [
            'Si a = 1, c\'est une translation (pas de centre)'
          ]
        },
        {
          id: 'cas_particuliers',
          titre: 'Cas particuliers',
          description: 'Translation, rotation, homothétie comme cas particuliers de similitude.',
          formules: [
            '\\text{Rotation : } a = e^{i\\theta}',
            '\\text{Homothétie : } a \\in \\mathbb{R}',
            '\\text{Translation : } a = 1'
          ],
          proprietes: [
            'Chaque cas a ses propriétés spécifiques',
            'Toutes sont des similitudes directes'
          ],
          methodes: [
            'Identifier le type à partir de a',
            'Appliquer les formules spécifiques'
          ],
          erreurs_frequentes: [
            'Confondre rotation et homothétie'
          ],
          pieges_examen: [
            'Bien reconnaître chaque cas'
          ]
        },
        {
          id: 'composition_similitudes',
          titre: 'Composition de similitudes',
          description: 'La composée de deux similitudes directes est une similitude directe.',
          formules: [
            'S_2 \\circ S_1 : z \\to a_2(a_1 z + b_1) + b_2 = (a_1 a_2)z + (a_2 b_1 + b_2)'
          ],
          proprietes: [
            'Les rapports se multiplient',
            'Les angles s\'additionnent'
          ],
          methodes: [
            'Composer les écritures complexes',
            'Simplifier'
          ],
          erreurs_frequentes: [
            'Confondre l\'ordre de composition'
          ],
          pieges_examen: [
            'Attention à l\'ordre : S_2 ∘ S_1 ≠ S_1 ∘ S_2 en général'
          ]
        },
        {
          id: 'applications_similitudes',
          titre: 'Applications géométriques',
          description: 'Résolution de problèmes géométriques par les similitudes.',
          formules: ['\\text{Utiliser z\' = az + b pour transformer des configurations}'],
          proprietes: [
            'Les similitudes transforment cercles en cercles',
            'Conservent les angles et rapports de distances'
          ],
          methodes: [
            'Identifier la transformation',
            'Écrire l\'équation complexe',
            'Résoudre le problème transformé'
          ],
          erreurs_frequentes: [
            'Oublier que la transformation est bijective',
            'Ne pas vérifier les hypothèses'
          ],
          pieges_examen: [
            'Utiliser les similitudes pour simplifier des problèmes complexes'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 3 — CALCUL DE PROBABILITÉS (8 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'calcul_probabilites',
      numero: 3,
      titre: 'Calcul de probabilités',
      description: 'Probabilités sur un univers fini, conditionnement, indépendance.',
      notions: [
        {
          id: 'vocabulaire_proba',
          titre: 'Vocabulaire (univers, événement)',
          description: 'Univers Ω, événements, événement élémentaire.',
          formules: [
            '\\Omega = \\text{ensemble des issues possibles}',
            'A \\subset \\Omega \\text{ est un événement}'
          ],
          proprietes: [
            'P(Ω) = 1',
            'P(∅) = 0'
          ],
          methodes: [
            'Identifier les issues possibles',
            'Décrire les événements'
          ],
          erreurs_frequentes: [
            'Confondre issue et événement'
          ],
          pieges_examen: [
            'Bien définir l\'univers avant tout calcul'
          ]
        },
        {
          id: 'probabilite_univers_fini',
          titre: 'Probabilité sur un univers fini',
          description: 'Définition d\'une probabilité par les poids des issues.',
          formules: [
            'P(A) = \\sum_{x \\in A} p(x)',
            '\\sum_{x \\in \\Omega} p(x) = 1'
          ],
          proprietes: [
            '0 ≤ P(A) ≤ 1',
            'P(Ω) = 1'
          ],
          methodes: [
            'Définir les poids des issues',
            'Calculer la probabilité par somme'
          ],
          erreurs_frequentes: [
            'Oublier de vérifier que la somme vaut 1'
          ],
          pieges_examen: [
            'Vérifier la cohérence des probabilités'
          ]
        },
        {
          id: 'evenement_contraire',
          titre: 'Événement contraire',
          description: 'Probabilité de l\'événement contraire : P(Ā) = 1 - P(A).',
          formules: ['P(\\bar{A}) = 1 - P(A)'],
          proprietes: [
            'Très utile pour simplifier les calculs'
          ],
          methodes: [
            'Identifier l\'événement contraire',
            'Calculer P(A) puis 1 - P(A)'
          ],
          erreurs_frequentes: [
            'Confondre contraire et incompatible'
          ],
          pieges_examen: [
            'Souvent plus simple de calculer la probabilité du contraire'
          ]
        },
        {
          id: 'reunion_intersection',
          titre: 'Réunion et intersection',
          description: 'Formules pour P(A ∪ B) et P(A ∩ B).',
          formules: ['P(A \\cup B) = P(A) + P(B) - P(A \\cap B)'],
          proprietes: [
            'Si A et B sont incompatibles : P(A ∪ B) = P(A) + P(B)',
            'P(A ∩ B) = 0 si A et B incompatibles'
          ],
          methodes: [
            'Identifier A et B',
            'Appliquer la formule appropriée'
          ],
          erreurs_frequentes: [
            'Oublier de soustraire P(A ∩ B)',
            'Confondre incompatible et indépendant'
          ],
          pieges_examen: [
            'Incompatible ≠ indépendant'
          ]
        },
        {
          id: 'probabilite_conditionnelle',
          titre: 'Probabilité conditionnelle',
          description: 'P_A(B) = P(A ∩ B) / P(A).',
          formules: ['P_A(B) = \\frac{P(A \\cap B)}{P(A)}', 'P(A \\cap B) = P(A) \\cdot P_A(B)'],
          proprietes: [
            'Définie si P(A) > 0',
            'Permet de calculer des probabilités conditionnelles'
          ],
          methodes: [
            'Identifier A et B',
            'Calculer P(A ∩ B) et P(A)',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Confondre P_A(B) et P_B(A)',
            'Utiliser sans vérifier P(A) > 0'
          ],
          pieges_examen: [
            'La formule de Bayes permet d\'inverser'
          ]
        },
        {
          id: 'probabilites_totales',
          titre: 'Formule des probabilités totales',
          description: 'P(B) = Σ P(A_i) × P_{A_i}(B) sur une partition.',
          formules: ['P(B) = \\sum_i P(A_i) \\cdot P_{A_i}(B)'],
          proprietes: [
            'Les A_i forment une partition de Ω',
            'Utilisée avec un arbre pondéré'
          ],
          methodes: [
            'Identifier la partition',
            'Calculer chaque terme',
            'Faire la somme'
          ],
          erreurs_frequentes: [
            'Ne pas vérifier que les A_i forment une partition'
          ],
          pieges_examen: [
            'Très utile avec un arbre de probabilités'
          ]
        },
        {
          id: 'formule_bayes',
          titre: 'Formule de Bayes',
          description: 'P_B(A) = P(A) × P_A(B) / P(B).',
          formules: ['P_B(A) = \\frac{P(A) \\cdot P_A(B)}{P(B)}'],
          proprietes: [
            'Permet d\'inverser les conditionnements',
            'Combinée aux probabilités totales'
          ],
          methodes: [
            'Utiliser P(B) = probabilités totales',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Confondre numérateur et dénominateur'
          ],
          pieges_examen: [
            'Bien identifier les événements et leurs probabilités'
          ]
        },
        {
          id: 'independance',
          titre: 'Indépendance en probabilité',
          description: 'A et B sont indépendants si P(A ∩ B) = P(A) × P(B).',
          formules: ['P(A \\cap B) = P(A) \\cdot P(B) \\iff A \\perp B'],
          proprietes: [
            'Si A et B sont indépendants, alors P_A(B) = P(B)',
            'Incompatible ≠ indépendant'
          ],
          methodes: [
            'Vérifier l\'égalité',
            'Utiliser dans les arbres pondérés'
          ],
          erreurs_frequentes: [
            'Confondre indépendant et incompatible'
          ],
          pieges_examen: [
            'Attention aux confusions classiques'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 4 — VARIABLE ALÉATOIRE (7 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'variable_aleatoire',
      numero: 4,
      titre: 'Variable aléatoire',
      description: 'Loi de probabilité, espérance, variance, lois usuelles.',
      notions: [
        {
          id: 'definition_variable_aleatoire',
          titre: 'Définition d\'une variable aléatoire',
          description: 'Une variable aléatoire X associe un nombre réel à chaque issue.',
          formules: ['X : \\Omega \\to \\mathbb{R}'],
          proprietes: [
            'Une variable aléatoire peut être discrète ou continue',
            'L\'ensemble des valeurs possibles est appelé support'
          ],
          methodes: [
            'Identifier les valeurs possibles',
            'Associer une probabilité à chaque valeur'
          ],
          erreurs_frequentes: [
            'Confondre variable et événement'
          ],
          pieges_examen: [
            'Bien distinguer X et ses valeurs'
          ]
        },
        {
          id: 'loi_probabilite',
          titre: 'Loi de probabilité',
          description: 'Tableau associant à chaque valeur de X sa probabilité.',
          formules: ['P(X = x_i) = p_i', '\\sum p_i = 1'],
          proprietes: [
            'La somme des probabilités vaut 1',
            'Chaque probabilité est entre 0 et 1'
          ],
          methodes: [
            'Lister les valeurs possibles',
            'Calculer chaque probabilité',
            'Vérifier la somme'
          ],
          erreurs_frequentes: [
            'Oublier des valeurs',
            'Oublier de vérifier la somme'
          ],
          pieges_examen: [
            'Toujours vérifier Σp_i = 1'
          ]
        },
        {
          id: 'esperance',
          titre: 'Espérance mathématique',
          description: 'E(X) = Σ x_i × p_i.',
          formules: ['E(X) = \\sum_i x_i \\cdot p_i'],
          proprietes: [
            'E(aX + b) = a E(X) + b',
            'E(X + Y) = E(X) + E(Y)'
          ],
          methodes: [
            'Utiliser la formule de définition',
            'Utiliser la linéarité'
          ],
          erreurs_frequentes: [
            'Confondre espérance et moyenne empirique'
          ],
          pieges_examen: [
            'E(X) est une valeur "moyenne" théorique'
          ]
        },
        {
          id: 'variance_ecart_type',
          titre: 'Variance et écart-type',
          description: 'V(X) = E(X²) - (E(X))², σ(X) = √V(X).',
          formules: [
            'V(X) = E(X^2) - (E(X))^2',
            'V(X) = \\sum_i (x_i - E(X))^2 \\cdot p_i',
            '\\sigma(X) = \\sqrt{V(X)}'
          ],
          proprietes: [
            'V(aX + b) = a² V(X)',
            'V(X) ≥ 0'
          ],
          methodes: [
            'Calculer E(X²) et (E(X))²',
            'Appliquer la formule de König'
          ],
          erreurs_frequentes: [
            'Oublier le carré dans V(aX + b)',
            'Confondre variance et écart-type'
          ],
          pieges_examen: [
            'V(aX) = a² V(X) (pas a V(X))'
          ]
        },
        {
          id: 'loi_binomiale',
          titre: 'Loi binomiale',
          description: 'Répétition d\'une épreuve de Bernoulli.',
          formules: [
            'P(X = k) = \\binom{n}{k} p^k (1-p)^{n-k}',
            'E(X) = np',
            'V(X) = np(1-p)'
          ],
          proprietes: [
            'n épreuves identiques et indépendantes',
            'Deux issues par épreuve (succès/échec)'
          ],
          methodes: [
            'Identifier n et p',
            'Utiliser la formule de Bernoulli',
            'Utiliser les formules pour E(X) et V(X)'
          ],
          erreurs_frequentes: [
            'Oublier le coefficient binomial',
            'Confondre n et k'
          ],
          pieges_examen: [
            'Toujours écrire X ~ B(n, p)'
          ]
        },
        {
          id: 'loi_normale',
          titre: 'Loi normale (introduction)',
          description: 'Loi continue en cloche, centrée sur μ.',
          formules: [
            'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
            '\\text{Standardisation : } Z = \\frac{X - \\mu}{\\sigma}'
          ],
          proprietes: [
            'Symétrique autour de μ',
            'L\'écart-type mesure la dispersion'
          ],
          methodes: [
            'Standardiser la variable',
            'Utiliser la table de la loi normale centrée réduite'
          ],
          erreurs_frequentes: [
            'Oublier de standardiser',
            'Confondre μ et σ'
          ],
          pieges_examen: [
            'Z suit N(0,1) après standardisation'
          ]
        },
        {
          id: 'applications_variable',
          titre: 'Applications',
          description: 'Applications à des problèmes concrets.',
          formules: ['\\text{Décider d\'un gain, d\'un coût, d\'un risque}'],
          proprietes: [
            'L\'espérance mesure le gain moyen',
            'La variance mesure le risque'
          ],
          methodes: [
            'Identifier la variable',
            'Déterminer sa loi',
            'Calculer E(X) et V(X)'
          ],
          erreurs_frequentes: [
            'Mauvaise modélisation'
          ],
          pieges_examen: [
            'Bien interpréter les résultats'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 5 — FONCTIONS NUMÉRIQUES (12 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'fonctions_numeriques',
      numero: 5,
      titre: 'Fonctions numériques',
      description: 'Limites, continuité, dérivabilité, études de fonctions.',
      notions: [
        {
          id: 'limites_fonction',
          titre: 'Limites d\'une fonction',
          description: 'Comportement d\'une fonction en un point ou en l\'infini.',
          formules: [
            '\\lim_{x \\to a} f(x) = L',
            '\\lim_{x \\to +\\infty} f(x) = L'
          ],
          proprietes: [
            'Unicité de la limite',
            'Compatibilité avec les opérations'
          ],
          methodes: [
            'Utiliser les limites usuelles',
            'Utiliser les théorèmes de comparaison'
          ],
          erreurs_frequentes: [
            'Confondre limite et valeur de la fonction',
            'Oublier les formes indéterminées'
          ],
          pieges_examen: [
            'Formes indéterminées : 0/0, ∞/∞, ∞-∞, 0×∞'
          ]
        },
        {
          id: 'croissances_comparees',
          titre: 'Croissances comparées',
          description: 'Comparaison des croissances : exponentielle, puissance, logarithme.',
          formules: [
            '\\lim_{x \\to +\\infty} \\frac{e^x}{x^n} = +\\infty',
            '\\lim_{x \\to +\\infty} \\frac{\\ln x}{x^n} = 0'
          ],
          proprietes: [
            'L\'exponentielle domine toute puissance',
            'Toute puissance domine le logarithme'
          ],
          methodes: [
            'Identifier la forme',
            'Appliquer la règle de dominance'
          ],
          erreurs_frequentes: [
            'Inverser les croissances'
          ],
          pieges_examen: [
            'À retenir par cœur : exp > puissance > log'
          ]
        },
        {
          id: 'continuite',
          titre: 'Continuité',
          description: 'Une fonction est continue en a si lim f(x) = f(a).',
          formules: ['\\lim_{x \\to a} f(x) = f(a)'],
          proprietes: [
            'Somme, produit, quotient de fonctions continues sont continues',
            'Composée de fonctions continues est continue'
          ],
          methodes: [
            'Vérifier la limite',
            'Vérifier l\'égalité avec f(a)'
          ],
          erreurs_frequentes: [
            'Oublier de vérifier la limite',
            'Confondre continuité et dérivabilité'
          ],
          pieges_examen: [
            'Continuité ≠ dérivabilité'
          ]
        },
        {
          id: 'theoreme_valeurs_intermediaires',
          titre: 'Théorème des valeurs intermédiaires',
          description: 'Si f est continue sur [a,b] et k est entre f(a) et f(b), alors ∃c tel que f(c) = k.',
          formules: ['f \\text{ continue sur } [a,b] \\text{ et } k \\in [f(a), f(b)] \\implies \\exists c \\in [a,b], f(c) = k'],
          proprietes: [
            'Garantit l\'existence d\'une solution',
            'Ne garantit pas l\'unicité'
          ],
          methodes: [
            'Vérifier la continuité',
            'Vérifier que k est entre f(a) et f(b)',
            'Conclure l\'existence'
          ],
          erreurs_frequentes: [
            'Oublier la continuité',
            'Confondre existence et unicité'
          ],
          pieges_examen: [
            'Combiner avec la monotonie pour l\'unicité'
          ]
        },
        {
          id: 'theoreme_bijection',
          titre: 'Théorème de la bijection',
          description: 'Si f est continue et strictement monotone sur I, elle réalise une bijection.',
          formules: ['f \\text{ continue et strictement monotone sur } I \\implies f \\text{ bijective de } I \\text{ sur } f(I)'],
          proprietes: [
            'Garantit l\'unicité de la solution',
            'La bijection réciproque est continue'
          ],
          methodes: [
            'Vérifier continuité et stricte monotonie',
            'Conclure la bijection',
            'Utiliser pour l\'unicité d\'une solution'
          ],
          erreurs_frequentes: [
            'Confondre stricte monotonie et monotonie'
          ],
          pieges_examen: [
            'La stricte monotonie est essentielle'
          ]
        },
        {
          id: 'derivabilite',
          titre: 'Dérivabilité',
          description: 'Une fonction est dérivable en a si le taux d\'accroissement admet une limite finie.',
          formules: ['f\'(a) = \\lim_{h \\to 0} \\frac{f(a+h) - f(a)}{h}'],
          proprietes: [
            'Dérivable ⟹ continue',
            'La réciproque est fausse'
          ],
          methodes: [
            'Calculer le taux d\'accroissement',
            'Prendre la limite'
          ],
          erreurs_frequentes: [
            'Confondre dérivabilité et continuité'
          ],
          pieges_examen: [
            'Dérivable ⟹ continue, mais pas l\'inverse'
          ]
        },
        {
          id: 'derivees_usuelles',
          titre: 'Dérivées usuelles',
          description: 'Dérivées des fonctions de référence.',
          formules: [
            '(x^n)\' = n x^{n-1}',
            '(e^x)\' = e^x',
            '(\\ln x)\' = \\frac{1}{x}',
            '(\\sin x)\' = \\cos x',
            '(\\cos x)\' = -\\sin x'
          ],
          proprietes: [
            'À connaître par cœur'
          ],
          methodes: [
            'Identifier la fonction',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Oublier le signe dans (cos)\'',
            'Confondre (x^n)\' et (n^x)\''
          ],
          pieges_examen: [
            'Attention au signe de (cos)\''
          ]
        },
        {
          id: 'operations_derivees',
          titre: 'Opérations sur les dérivées',
          description: 'Dérivée d\'une somme, produit, quotient, composée.',
          formules: [
            '(u+v)\' = u\' + v\'',
            '(uv)\' = u\'v + uv\'',
            '(u/v)\' = \\frac{u\'v - uv\'}{v^2}',
            '(f \\circ g)\' = g\' \\cdot (f\' \\circ g)'
          ],
          proprietes: [
            'Toutes ces formules sont à connaître'
          ],
          methodes: [
            'Identifier la forme',
            'Appliquer la formule appropriée'
          ],
          erreurs_frequentes: [
            'Confondre (uv)\' et u\'v\'',
            'Oublier le dénominateur dans (u/v)\''
          ],
          pieges_examen: [
            '(uv)\' ≠ u\'v\' — erreur classique'
          ]
        },
        {
          id: 'derivee_composee',
          titre: 'Dérivée composée',
          description: 'Formule de dérivation en chaîne.',
          formules: [
            '(f \\circ g)\'(x) = g\'(x) \\cdot f\'(g(x))',
            '(u^n)\' = n u^{n-1} u\'',
            '(e^u)\' = u\' e^u',
            '(\\ln u)\' = \\frac{u\'}{u}'
          ],
          proprietes: [
            'Formule fondamentale',
            'Très utilisée au BAC'
          ],
          methodes: [
            'Identifier u et u\'',
            'Appliquer la formule',
            'Simplifier'
          ],
          erreurs_frequentes: [
            'Oublier le u\'',
            'Confondre avec la dérivée simple'
          ],
          pieges_examen: [
            'Ne jamais oublier le u\' dans la dérivée composée'
          ]
        },
        {
          id: 'sens_variation',
          titre: 'Sens de variation',
          description: 'Étude du signe de la dérivée.',
          formules: [
            'f\' > 0 \\implies f \\text{ croissante}',
            'f\' < 0 \\implies f \\text{ décroissante}'
          ],
          proprietes: [
            'Lien entre signe de f\' et variations de f'
          ],
          methodes: [
            'Calculer f\'',
            'Étudier son signe',
            'Dresser le tableau de variations'
          ],
          erreurs_frequentes: [
            'Confondre f\' et f',
            'Oublier les zéros de f\''
          ],
          pieges_examen: [
            'Bien faire le tableau de signes de f\''
          ]
        },
        {
          id: 'extremums_locaux',
          titre: 'Extremums locaux',
          description: 'Maximum et minimum locaux.',
          formules: ['f\'(a) = 0 \\text{ et } f\' \\text{ change de signe en } a \\implies f(a) \\text{ extremum local}'],
          proprietes: [
            'f\'(a) = 0 est une condition nécessaire (pas suffisante)',
            'Il faut vérifier le changement de signe'
          ],
          methodes: [
            'Résoudre f\'(x) = 0',
            'Étudier le signe de f\' autour'
          ],
          erreurs_frequentes: [
            'Conclure extremum dès que f\' = 0',
            'Oublier de vérifier le changement de signe'
          ],
          pieges_examen: [
            'f\' = 0 ne suffit pas (ex: x³ en 0)'
          ]
        },
        {
          id: 'etude_complete',
          titre: 'Étude complète d\'une fonction',
          description: 'Méthode complète : domaine, limites, dérivée, variations, courbe.',
          formules: ['\\text{Étapes : domaine, limites, f\', tableau, courbe}'],
          proprietes: [
            'Étude structurée en plusieurs étapes'
          ],
          methodes: [
            'Déterminer le domaine de définition',
            'Calculer les limites aux bornes',
            'Calculer la dérivée',
            'Dresser le tableau de variations',
            'Tracer la courbe'
          ],
          erreurs_frequentes: [
            'Oublier une étape',
            'Erreur dans le domaine'
          ],
          pieges_examen: [
            'Bien justifier chaque étape'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 6 — FONCTION LOGARITHME NÉPÉRIEN (8 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'logarithme_neperien',
      numero: 6,
      titre: 'Fonction logarithme népérien',
      description: 'Définition, propriétés, dérivée, limites.',
      notions: [
        {
          id: 'definition_ln',
          titre: 'Définition de ln',
          description: 'ln est la primitive de 1/x qui s\'annule en 1.',
          formules: ['\\ln(1) = 0', '\\ln\'(x) = \\frac{1}{x}'],
          proprietes: [
            'Définie sur ]0, +∞[',
            'Strictement croissante',
            'ln(e) = 1'
          ],
          methodes: [
            'Utiliser les propriétés algébriques',
            'Utiliser la relation avec exp'
          ],
          erreurs_frequentes: [
            'Oublier le domaine',
            'Confondre ln et log'
          ],
          pieges_examen: [
            'ln(x) n\'est définie que pour x > 0'
          ]
        },
        {
          id: 'proprietes_ln',
          titre: 'Propriétés algébriques',
          description: 'Propriétés fondamentales du logarithme.',
          formules: [
            '\\ln(ab) = \\ln a + \\ln b',
            '\\ln(a/b) = \\ln a - \\ln b',
            '\\ln(a^n) = n \\ln a',
            '\\ln(\\sqrt{a}) = \\frac{1}{2} \\ln a'
          ],
          proprietes: [
            'Transforme produits en sommes',
            'Transforme quotients en différences'
          ],
          methodes: [
            'Décomposer une expression',
            'Recomposer si nécessaire'
          ],
          erreurs_frequentes: [
            'Confondre ln(a+b) et ln(a) + ln(b)',
            'Oublier les conditions de positivité'
          ],
          pieges_examen: [
            'ln(a+b) ≠ ln(a) + ln(b)'
          ]
        },
        {
          id: 'derivee_ln',
          titre: 'Dérivée de ln',
          description: '(ln x)\' = 1/x et (ln u)\' = u\'/u.',
          formules: ['(\\ln x)\' = \\frac{1}{x}', '(\\ln u)\' = \\frac{u\'}{u}'],
          proprietes: [
            'Fondamentale pour la dérivation'
          ],
          methodes: [
            'Identifier u',
            'Calculer u\'',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Oublier u\' dans la composée'
          ],
          pieges_examen: [
            'Ne pas oublier le u\' dans (ln u)\''
          ]
        },
        {
          id: 'limites_ln',
          titre: 'Limites de ln',
          description: 'Limites aux bornes du domaine.',
          formules: [
            '\\lim_{x \\to +\\infty} \\ln x = +\\infty',
            '\\lim_{x \\to 0^+} \\ln x = -\\infty',
            '\\lim_{x \\to +\\infty} \\frac{\\ln x}{x} = 0',
            '\\lim_{x \\to 0} \\frac{\\ln(1+x)}{x} = 1'
          ],
          proprietes: [
            'Croissance très lente',
            'Croissance comparée avec x'
          ],
          methodes: [
            'Utiliser les limites usuelles',
            'Utiliser la croissance comparée'
          ],
          erreurs_frequentes: [
            'Confondre les limites en 0 et +∞'
          ],
          pieges_examen: [
            'Limite en 0+ = -∞, PAS +∞'
          ]
        },
        {
          id: 'etude_ln',
          titre: 'Étude de ln',
          description: 'Tableau de variations et courbe.',
          formules: ['\\text{ln est strictement croissante sur } ]0, +\\infty['],
          proprietes: [
            'Courbe passe par (1, 0) et (e, 1)'
          ],
          methodes: [
            'Utiliser les limites',
            'Utiliser la dérivée'
          ],
          erreurs_frequentes: [
            'Mauvais tableau de variations'
          ],
          pieges_examen: [
            'Bien placer les points remarquables'
          ]
        },
        {
          id: 'derivee_ln_u',
          titre: 'Dérivée de ln(u)',
          description: '(ln u)\' = u\'/u.',
          formules: ['(\\ln u)\' = \\frac{u\'}{u}'],
          proprietes: [
            'Très utilisée',
            'u doit être strictement positive'
          ],
          methodes: [
            'Identifier u',
            'Calculer u\'',
            'Appliquer'
          ],
          erreurs_frequentes: [
            'Oublier u\'',
            'Ne pas vérifier u > 0'
          ],
          pieges_examen: [
            'u > 0 est obligatoire'
          ]
        },
        {
          id: 'equations_ln',
          titre: 'Équations et inéquations avec ln',
          description: 'Résolution d\'équations impliquant ln.',
          formules: [
            '\\ln x = a \\iff x = e^a',
            '\\ln x = \\ln y \\iff x = y'
          ],
          proprietes: [
            'Utiliser la bijection de ln',
            'Vérifier les conditions de domaine'
          ],
          methodes: [
            'Isoler ln',
            'Utiliser l\'exponentielle',
            'Vérifier le domaine'
          ],
          erreurs_frequentes: [
            'Oublier de vérifier le domaine',
            'Erreur dans l\'exponentiation'
          ],
          pieges_examen: [
            'Vérifier x > 0 après résolution'
          ]
        },
        {
          id: 'applications_ln',
          titre: 'Applications',
          description: 'Applications de ln en sciences et économie.',
          formules: ['\\text{Croissance, décroissance, échelles logarithmiques}'],
          proprietes: [
            'Utilisé dans de nombreux contextes'
          ],
          methodes: [
            'Identifier le contexte',
            'Utiliser ln pour linéariser'
          ],
          erreurs_frequentes: [
            'Mauvaise modélisation'
          ],
          pieges_examen: [
            'Comprendre le contexte avant de calculer'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 7 — FONCTION EXPONENTIELLE (9 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'fonction_exponentielle',
      numero: 7,
      titre: 'Fonction exponentielle',
      description: 'Définition, propriétés, dérivée, limites.',
      notions: [
        {
          id: 'definition_exp',
          titre: 'Définition de exp',
          description: 'exp est la réciproque de ln.',
          formules: ['e^x = y \\iff \\ln y = x', '\\exp(0) = 1'],
          proprietes: [
            'Définie sur ℝ',
            'Strictement croissante',
            'Toujours positive'
          ],
          methodes: [
            'Utiliser la relation avec ln',
            'Utiliser les propriétés algébriques'
          ],
          erreurs_frequentes: [
            'Confondre exp et puissance',
            'Oublier que exp > 0'
          ],
          pieges_examen: [
            'exp(x) > 0 pour tout x'
          ]
        },
        {
          id: 'proprietes_exp',
          titre: 'Propriétés algébriques',
          description: 'Propriétés fondamentales de l\'exponentielle.',
          formules: [
            'e^{a+b} = e^a \\cdot e^b',
            'e^{a-b} = \\frac{e^a}{e^b}',
            '(e^a)^n = e^{na}'
          ],
          proprietes: [
            'Transforme sommes en produits',
            'Transforme différences en quotients'
          ],
          methodes: [
            'Décomposer une expression',
            'Recomposer si nécessaire'
          ],
          erreurs_frequentes: [
            'Confondre e^(a+b) et e^a + e^b'
          ],
          pieges_examen: [
            'e^(a+b) ≠ e^a + e^b'
          ]
        },
        {
          id: 'derivee_exp',
          titre: 'Dérivée de exp',
          description: '(e^x)\' = e^x et (e^u)\' = u\' e^u.',
          formules: ['(e^x)\' = e^x', '(e^u)\' = u\' e^u'],
          proprietes: [
            'L\'exponentielle est sa propre dérivée'
          ],
          methodes: [
            'Identifier u',
            'Calculer u\'',
            'Appliquer'
          ],
          erreurs_frequentes: [
            'Oublier u\' dans la composée'
          ],
          pieges_examen: [
            'Ne pas oublier le u\' dans (e^u)\''
          ]
        },
        {
          id: 'limites_exp',
          titre: 'Limites de exp',
          description: 'Limites aux bornes.',
          formules: [
            '\\lim_{x \\to +\\infty} e^x = +\\infty',
            '\\lim_{x \\to -\\infty} e^x = 0',
            '\\lim_{x \\to +\\infty} \\frac{e^x}{x} = +\\infty',
            '\\lim_{x \\to 0} \\frac{e^x - 1}{x} = 1'
          ],
          proprietes: [
            'Croissance très rapide'
          ],
          methodes: [
            'Utiliser les limites usuelles',
            'Utiliser la croissance comparée'
          ],
          erreurs_frequentes: [
            'Confondre limites en +∞ et -∞'
          ],
          pieges_examen: [
            'Limite en -∞ = 0, PAS -∞'
          ]
        },
        {
          id: 'etude_exp',
          titre: 'Étude de exp',
          description: 'Tableau de variations et courbe.',
          formules: ['\\text{exp est strictement croissante sur } \\mathbb{R}'],
          proprietes: [
            'Courbe passe par (0, 1) et (1, e)'
          ],
          methodes: [
            'Utiliser les limites',
            'Utiliser la dérivée'
          ],
          erreurs_frequentes: [
            'Mauvais tableau de variations'
          ],
          pieges_examen: [
            'Bien placer les points remarquables'
          ]
        },
        {
          id: 'derivee_exp_u',
          titre: 'Dérivée de exp(u)',
          description: '(e^u)\' = u\' e^u.',
          formules: ['(e^u)\' = u\' e^u'],
          proprietes: [
            'Très utilisée',
            'Composée importante'
          ],
          methodes: [
            'Identifier u',
            'Calculer u\'',
            'Appliquer'
          ],
          erreurs_frequentes: [
            'Oublier u\''
          ],
          pieges_examen: [
            'Ne jamais oublier u\''
          ]
        },
        {
          id: 'relation_ln_exp',
          titre: 'Relation ln / exp',
          description: 'ln et exp sont réciproques.',
          formules: [
            '\\ln(e^x) = x',
            'e^{\\ln x} = x \\text{ pour } x > 0'
          ],
          proprietes: [
            'Bijection réciproque',
            'Symétrie par rapport à y = x'
          ],
          methodes: [
            'Utiliser pour simplifier',
            'Utiliser pour résoudre'
          ],
          erreurs_frequentes: [
            'Oublier le domaine',
            'Appliquer à des valeurs négatives'
          ],
          pieges_examen: [
            'ln(e^x) = x pour tout x, mais e^(ln x) = x seulement si x > 0'
          ]
        },
        {
          id: 'equations_exp',
          titre: 'Équations et inéquations avec exp',
          description: 'Résolution d\'équations impliquant exp.',
          formules: [
            'e^x = a \\iff x = \\ln a \\text{ si } a > 0',
            'e^x = e^y \\iff x = y'
          ],
          proprietes: [
            'Utiliser la bijection de exp'
          ],
          methodes: [
            'Isoler exp',
            'Utiliser ln',
            'Vérifier les conditions'
          ],
          erreurs_frequentes: [
            'Oublier que e^x > 0'
          ],
          pieges_examen: [
            'e^x = -1 n\'a pas de solution'
          ]
        },
        {
          id: 'applications_exp',
          titre: 'Applications',
          description: 'Applications en sciences et économie.',
          formules: ['\\text{Croissance exponentielle, décroissance radioactive}'],
          proprietes: [
            'Modélise de nombreux phénomènes'
          ],
          methodes: [
            'Modéliser le phénomène',
            'Résoudre l\'équation différentielle',
            'Interpréter'
          ],
          erreurs_frequentes: [
            'Mauvaise modélisation'
          ],
          pieges_examen: [
            'Comprendre le contexte'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 8 — CALCUL INTÉGRAL (10 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'calcul_integral',
      numero: 8,
      titre: 'Calcul intégral',
      description: 'Primitives, intégrales, techniques de calcul.',
      notions: [
        {
          id: 'primitives_definition',
          titre: 'Primitives — définition',
          description: 'F est une primitive de f si F\' = f.',
          formules: ['F\' = f \\iff F \\text{ est une primitive de } f'],
          proprietes: [
            'Toute primitive diffère d\'une constante',
            'Il y a une infinité de primitives'
          ],
          methodes: [
            'Identifier une primitive connue',
            'Utiliser les tableaux de primitives'
          ],
          erreurs_frequentes: [
            'Oublier la constante C'
          ],
          pieges_examen: [
            'Toujours ajouter + C'
          ]
        },
        {
          id: 'primitives_usuelles',
          titre: 'Primitives usuelles',
          description: 'Primitives des fonctions de référence.',
          formules: [
            '\\int x^n dx = \\frac{x^{n+1}}{n+1} + C',
            '\\int \\frac{1}{x} dx = \\ln|x| + C',
            '\\int e^x dx = e^x + C',
            '\\int \\cos x\\, dx = \\sin x + C',
            '\\int \\sin x\\, dx = -\\cos x + C'
          ],
          proprietes: [
            'Tableau à connaître par cœur'
          ],
          methodes: [
            'Identifier la forme',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Oublier la constante',
            'Confondre avec les dérivées'
          ],
          pieges_examen: [
            'Ne pas oublier + C'
          ]
        },
        {
          id: 'primitives_composees',
          titre: 'Primitives composées',
          description: 'Primitives de fonctions composées.',
          formules: [
            '\\int u\' u^n dx = \\frac{u^{n+1}}{n+1} + C',
            '\\int \\frac{u\'}{u} dx = \\ln|u| + C',
            '\\int u\' e^u dx = e^u + C'
          ],
          proprietes: [
            'Basées sur la dérivation composée'
          ],
          methodes: [
            'Identifier u et u\'',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Oublier de vérifier la présence de u\''
          ],
          pieges_examen: [
            'u\' doit être présent dans l\'intégrale'
          ]
        },
        {
          id: 'integrale_definition',
          titre: 'Intégrale — définition',
          description: 'Intégrale de a à b = F(b) - F(a).',
          formules: ['\\int_a^b f(x)\\, dx = F(b) - F(a)'],
          proprietes: [
            'Indépendante de la primitive choisie',
            'Aire sous la courbe si f ≥ 0'
          ],
          methodes: [
            'Trouver une primitive',
            'Évaluer en b et a',
            'Soustraire'
          ],
          erreurs_frequentes: [
            'Inverser b et a',
            'Confondre primitive et intégrale'
          ],
          pieges_examen: [
            'Attention aux signes'
          ]
        },
        {
          id: 'proprietes_integrale',
          titre: 'Propriétés de l\'intégrale',
          description: 'Linéarité, positivité, encadrement.',
          formules: [
            '\\int_a^b (\\alpha f + \\beta g) = \\alpha \\int_a^b f + \\beta \\int_a^b g',
            'f \\geq 0 \\implies \\int_a^b f \\geq 0'
          ],
          proprietes: [
            'Linéarité',
            'Compatibilité avec l\'ordre'
          ],
          methodes: [
            'Décomposer',
            'Utiliser les propriétés'
          ],
          erreurs_frequentes: [
            'Oublier les coefficients'
          ],
          pieges_examen: [
            'Attention aux bornes'
          ]
        },
        {
          id: 'linearite',
          titre: 'Linéarité',
          description: 'L\'intégrale est linéaire.',
          formules: ['\\int (af + bg) = a\\int f + b\\int g'],
          proprietes: [
            'Très utilisée'
          ],
          methodes: [
            'Séparer les termes',
            'Factoriser les constantes'
          ],
          erreurs_frequentes: [
            'Confondre avec la multiplication'
          ],
          pieges_examen: [
            'Seules les constantes sortent'
          ]
        },
        {
          id: 'relation_chasles',
          titre: 'Relation de Chasles',
          description: 'Décomposition d\'une intégrale.',
          formules: ['\\int_a^c f = \\int_a^b f + \\int_b^c f'],
          proprietes: [
            'Très utile pour les valeurs absolues'
          ],
          methodes: [
            'Identifier le point de découpage',
            'Décomposer'
          ],
          erreurs_frequentes: [
            'Oublier le point de découpage'
          ],
          pieges_examen: [
            'Utile pour les intégrales avec valeur absolue'
          ]
        },
        {
          id: 'integration_parties',
          titre: 'Intégration par parties',
          description: 'Méthode pour intégrer un produit.',
          formules: ['\\int_a^b u\'v\\, dx = [uv]_a^b - \\int_a^b uv\'\\, dx'],
          proprietes: [
            'Utile pour les produits',
            'Choix de u\' et v important'
          ],
          methodes: [
            'Choisir u\' et v',
            'Appliquer la formule',
            'Simplifier'
          ],
          erreurs_frequentes: [
            'Mauvais choix de u\' et v'
          ],
          pieges_examen: [
            'Choisir u\' facile à intégrer'
          ]
        },
        {
          id: 'calcul_aires',
          titre: 'Calcul d\'aires',
          description: 'Aire entre deux courbes.',
          formules: ['A = \\int_a^b |f(x) - g(x)|\\, dx'],
          proprietes: [
            'Aire toujours positive'
          ],
          methodes: [
            'Identifier f et g',
            'Étudier le signe de f - g',
            'Intégrer'
          ],
          erreurs_frequentes: [
            'Oublier la valeur absolue'
          ],
          pieges_examen: [
            'Vérifier le signe de f - g'
          ]
        },
        {
          id: 'valeur_moyenne',
          titre: 'Valeur moyenne',
          description: 'Valeur moyenne d\'une fonction sur [a,b].',
          formules: ['\\bar{f} = \\frac{1}{b-a} \\int_a^b f(x)\\, dx'],
          proprietes: [
            'Généralise la moyenne arithmétique'
          ],
          methodes: [
            'Calculer l\'intégrale',
            'Diviser par (b-a)'
          ],
          erreurs_frequentes: [
            'Oublier de diviser'
          ],
          pieges_examen: [
            'Bien diviser par (b-a)'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 9 — ÉQUATIONS DIFFÉRENTIELLES (5 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'equations_differentielles',
      numero: 9,
      titre: 'Équations différentielles',
      description: 'Équations y\' = ay, y\' = ay + b, y\' = ay + f(x).',
      notions: [
        {
          id: 'equation_y_prime_ay',
          titre: 'y\' = ay',
          description: 'Solutions de la forme C e^(ax).',
          formules: ['y\' = ay \\iff y(x) = C e^{ax}'],
          proprietes: [
            'C est déterminée par une condition initiale'
          ],
          methodes: [
            'Identifier a',
            'Écrire la solution générale',
            'Utiliser la condition initiale'
          ],
          erreurs_frequentes: [
            'Oublier la constante C',
            'Confondre a et C'
          ],
          pieges_examen: [
            'Ne pas oublier la condition initiale'
          ]
        },
        {
          id: 'equation_y_prime_ay_b',
          titre: 'y\' = ay + b',
          description: 'Solution particulière constante + solution homogène.',
          formules: ['y\' = ay + b \\iff y(x) = C e^{ax} - \\frac{b}{a}'],
          proprietes: [
            'Solution particulière : y₀ = -b/a',
            'Somme des solutions homogène et particulière'
          ],
          methodes: [
            'Chercher une solution particulière constante',
            'Ajouter la solution homogène',
            'Utiliser la condition initiale'
          ],
          erreurs_frequentes: [
            'Oublier la solution particulière'
          ],
          pieges_examen: [
            'Toujours ajouter la solution particulière'
          ]
        },
        {
          id: 'equation_y_prime_ay_fx',
          titre: 'y\' = ay + f(x)',
          description: 'Solution = homogène + particulière.',
          formules: ['y = y_h + y_p'],
          proprietes: [
            'Principe de superposition',
            'Solution particulière à chercher selon f'
          ],
          methodes: [
            'Résoudre l\'équation homogène',
            'Chercher une solution particulière',
            'Additionner'
          ],
          erreurs_frequentes: [
            'Oublier la solution homogène',
            'Mauvaise forme de solution particulière'
          ],
          pieges_examen: [
            'Adapter la forme de y_p selon f'
          ]
        },
        {
          id: 'conditions_initiales',
          titre: 'Conditions initiales',
          description: 'Détermination de la constante C.',
          formules: ['y(x_0) = y_0 \\implies \\text{déterminer } C'],
          proprietes: [
            'Une condition initiale détermine C de manière unique'
          ],
          methodes: [
            'Écrire la solution générale',
            'Remplacer x par x₀ et y par y₀',
            'Résoudre pour C'
          ],
          erreurs_frequentes: [
            'Erreur de calcul',
            'Oublier de remplacer'
          ],
          pieges_examen: [
            'Bien vérifier les conditions initiales'
          ]
        },
        {
          id: 'applications_equa_diff',
          titre: 'Applications',
          description: 'Applications en physique, biologie, économie.',
          formules: ['\\text{Croissance, décroissance, refroidissement}'],
          proprietes: [
            'Nombreuses applications concrètes'
          ],
          methodes: [
            'Modéliser le phénomène',
            'Résoudre l\'équation',
            'Interpréter'
          ],
          erreurs_frequentes: [
            'Mauvaise modélisation'
          ],
          pieges_examen: [
            'Comprendre le contexte'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 10 — SUITES NUMÉRIQUES (8 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'suites_numeriques',
      numero: 10,
      titre: 'Suites numériques',
      description: 'Suites arithmétiques, géométriques, convergence.',
      notions: [
        {
          id: 'definition_suite',
          titre: 'Définition d\'une suite',
          description: 'Application de ℕ (ou d\'une partie) dans ℝ.',
          formules: ['u : \\mathbb{N} \\to \\mathbb{R}', 'n \\mapsto u_n'],
          proprietes: [
            'Une suite peut être définie explicitement ou par récurrence'
          ],
          methodes: [
            'Identifier la forme de définition',
            'Calculer les premiers termes'
          ],
          erreurs_frequentes: [
            'Confondre u_n et u_{n+1}'
          ],
          pieges_examen: [
            'Bien lire la définition'
          ]
        },
        {
          id: 'suite_arithmetique',
          titre: 'Suite arithmétique',
          description: 'u_{n+1} = u_n + r.',
          formules: [
            'u_{n+1} = u_n + r',
            'u_n = u_0 + n r',
            'u_n = u_p + (n-p) r'
          ],
          proprietes: [
            'Croissance linéaire',
            'Différence constante'
          ],
          methodes: [
            'Identifier r',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Confondre avec géométrique'
          ],
          pieges_examen: [
            'u_n = u_0 + n r (pas u_0 × r)'
          ]
        },
        {
          id: 'suite_geometrique',
          titre: 'Suite géométrique',
          description: 'u_{n+1} = q × u_n.',
          formules: [
            'u_{n+1} = q \\cdot u_n',
            'u_n = u_0 \\cdot q^n',
            'u_n = u_p \\cdot q^{n-p}'
          ],
          proprietes: [
            'Croissance exponentielle',
            'Quotient constant'
          ],
          methodes: [
            'Identifier q',
            'Appliquer la formule'
          ],
          erreurs_frequentes: [
            'Confondre avec arithmétique'
          ],
          pieges_examen: [
            'u_n = u_0 × q^n (pas u_0 + q^n)'
          ]
        },
        {
          id: 'sens_variation_suite',
          titre: 'Sens de variation',
          description: 'Étude de la monotonie d\'une suite.',
          formules: [
            'u_{n+1} - u_n \\geq 0 \\implies \\text{croissante}',
            '\\frac{u_{n+1}}{u_n} \\geq 1 \\implies \\text{croissante si } u_n > 0'
          ],
          proprietes: [
            'Deux méthodes : différence ou quotient'
          ],
          methodes: [
            'Calculer u_{n+1} - u_n',
            'Étudier le signe',
            'OU calculer u_{n+1}/u_n'
          ],
          erreurs_frequentes: [
            'Confondre les méthodes'
          ],
          pieges_examen: [
            'Choisir la méthode la plus simple'
          ]
        },
        {
          id: 'convergence_limite',
          titre: 'Convergence et limite',
          description: 'Convergence d\'une suite.',
          formules: [
            '\\lim_{n \\to +\\infty} u_n = L',
            'q^n \\to 0 \\text{ si } |q| < 1'
          ],
          proprietes: [
            'Suite convergente = admet une limite finie'
          ],
          methodes: [
            'Utiliser les limites usuelles',
            'Utiliser les théorèmes de convergence'
          ],
          erreurs_frequentes: [
            'Confondre convergente et bornée'
          ],
          pieges_examen: [
            'Bien distinguer les cas selon q'
          ]
        },
        {
          id: 'raisonnement_recurrence',
          titre: 'Raisonnement par récurrence',
          description: 'Méthode de démonstration pour les suites.',
          formules: [
            '1) \\text{Initialisation : } P(n_0)',
            '2) \\text{Hérédité : } P(n) \\implies P(n+1)',
            '3) \\text{Conclusion}'
          ],
          proprietes: [
            'Méthode puissante pour démontrer des propriétés'
          ],
          methodes: [
            'Vérifier P(n₀)',
            'Supposer P(n) et montrer P(n+1)',
            'Conclure'
          ],
          erreurs_frequentes: [
            'Oublier l\'initialisation',
            'Mauvaise hérédité'
          ],
          pieges_examen: [
            'Bien rédiger les 3 étapes'
          ]
        },
        {
          id: 'suites_bornees',
          titre: 'Suites majorées / minorées',
          description: 'Suites bornées.',
          formules: [
            'u_n \\leq M \\implies \\text{majorée}',
            'u_n \\geq m \\implies \\text{minorée}',
            '\\text{bornée = majorée et minorée}'
          ],
          proprietes: [
            'Toute suite convergente est bornée',
            'La réciproque est fausse'
          ],
          methodes: [
            'Démontrer par récurrence',
            'Utiliser les variations'
          ],
          erreurs_frequentes: [
            'Confondre majorée et croissante'
          ],
          pieges_examen: [
            'Convergente ⟹ bornée, mais pas l\'inverse'
          ]
        },
        {
          id: 'applications_suites',
          titre: 'Applications',
          description: 'Applications des suites.',
          formules: ['\\text{Modélisation de phénomènes discrets}'],
          proprietes: [
            'Utiles en économie, biologie'
          ],
          methodes: [
            'Modéliser',
            'Résoudre',
            'Interpréter'
          ],
          erreurs_frequentes: [
            'Mauvaise modélisation'
          ],
          pieges_examen: [
            'Comprendre le contexte'
          ]
        }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // CHAPITRE 11 — STATISTIQUES (6 notions)
    // ═══════════════════════════════════════════════════════════
    {
      id: 'statistiques',
      numero: 11,
      titre: 'Statistiques',
      description: 'Séries statistiques, ajustement linéaire, corrélation.',
      notions: [
        {
          id: 'serie_statistique',
          titre: 'Série statistique',
          description: 'Ensemble de données quantitatives.',
          formules: ['\\text{Série : } (x_i, n_i)'],
          proprietes: [
            'Effectifs, fréquences',
            'Séries discrètes ou continues'
          ],
          methodes: [
            'Organiser les données',
            'Calculer les effectifs cumulés'
          ],
          erreurs_frequentes: [
            'Confondre effectif et fréquence'
          ],
          pieges_examen: [
            'Bien organiser les données'
          ]
        },
        {
          id: 'moyenne_mediane_quartiles',
          titre: 'Moyenne, médiane, quartiles',
          description: 'Indicateurs de position.',
          formules: [
            '\\bar{x} = \\frac{1}{N} \\sum n_i x_i',
            '\\text{Médiane : 50\\% des valeurs en dessous}',
            'Q_1, Q_3 : \\text{quartiles}'
          ],
          proprietes: [
            'Moyenne sensible aux extrêmes',
            'Médiane robuste'
          ],
          methodes: [
            'Calculer la moyenne',
            'Trier les données pour la médiane',
            'Utiliser les effectifs cumulés pour Q1 et Q3'
          ],
          erreurs_frequentes: [
            'Confondre médiane et moyenne'
          ],
          pieges_examen: [
            'Bien trier les données'
          ]
        },
        {
          id: 'ecart_type',
          titre: 'Écart-type',
          description: 'Mesure de dispersion.',
          formules: [
            '\\sigma = \\sqrt{\\frac{1}{N} \\sum n_i (x_i - \\bar{x})^2}',
            'V = \\sigma^2'
          ],
          proprietes: [
            'Écart-type ≥ 0',
            'Unité identique à celle des données'
          ],
          methodes: [
            'Calculer la moyenne',
            'Calculer les écarts',
            'Élever au carré',
            'Faire la moyenne',
            'Prendre la racine'
          ],
          erreurs_frequentes: [
            'Oublier la racine'
          ],
          pieges_examen: [
            'Écart-type = √variance'
          ]
        },
        {
          id: 'ajustement_lineaire',
          titre: 'Ajustement linéaire',
          description: 'Régression linéaire par moindres carrés.',
          formules: [
            'y = ax + b',
            'a = \\frac{Cov(x,y)}{V(x)}',
            'b = \\bar{y} - a\\bar{x}'
          ],
          proprietes: [
            'Droite de régression de y en x',
            'Passe par le point moyen'
          ],
          methodes: [
            'Calculer moyennes, variance, covariance',
            'Calculer a et b',
            'Écrire l\'équation'
          ],
          erreurs_frequentes: [
            'Confondre régression de y en x et de x en y'
          ],
          pieges_examen: [
            'Attention aux formules de a et b'
          ]
        },
        {
          id: 'correlation',
          titre: 'Corrélation',
          description: 'Coefficient de corrélation linéaire.',
          formules: ['r = \\frac{Cov(x,y)}{\\sigma_x \\sigma_y}'],
          proprietes: [
            '-1 ≤ r ≤ 1',
            'r proche de ±1 : forte corrélation',
            'r proche de 0 : pas de corrélation linéaire'
          ],
          methodes: [
            'Calculer covariance et écarts-types',
            'Appliquer la formule',
            'Interpréter'
          ],
          erreurs_frequentes: [
            'Confondre r et r²'
          ],
          pieges_examen: [
            'Bien interpréter la valeur de r'
          ]
        },
        {
          id: 'applications_statistiques',
          titre: 'Applications',
          description: 'Applications des statistiques.',
          formules: ['\\text{Prévisions, tendances, comparaisons}'],
          proprietes: [
            'Utiles en économie, sociologie'
          ],
          methodes: [
            'Analyser les données',
            'Faire des prévisions',
            'Interpréter'
          ],
          erreurs_frequentes: [
            'Extrapoler abusivement'
          ],
          pieges_examen: [
            'Bien justifier les prévisions'
          ]
        }
      ]
    }
  ]
};

// ================================================================
// FONCTIONS UTILITAIRES
// ================================================================

/**
 * Récupère un chapitre par son ID.
 */
function getChapitre(chapitreId) {
  return BAC_MATHEMATIQUES.chapitres.find((c) => c.id === chapitreId) || null;
}

/**
 * Récupère une notion par son ID (dans un chapitre donné).
 */
function getNotion(chapitreId, notionId) {
  const chapitre = getChapitre(chapitreId);
  if (!chapitre) return null;
  return chapitre.notions.find((n) => n.id === notionId) || null;
}

/**
 * Liste tous les chapitres.
 */
function getChapitres() {
  return BAC_MATHEMATIQUES.chapitres.map((c) => ({
    id: c.id,
    numero: c.numero,
    titre: c.titre,
    description: c.description,
    notionsCount: c.notions.length
  }));
}

/**
 * Liste toutes les notions d'un chapitre.
 */
function getNotionsChapitre(chapitreId) {
  const chapitre = getChapitre(chapitreId);
  return chapitre ? chapitre.notions : [];
}

/**
 * Retourne les IDs de toutes les notions obligatoires.
 */
function getNotionsObligatoires(chapitreId) {
  const chapitre = getChapitre(chapitreId);
  if (!chapitre) return [];
  return chapitre.notions.map((n) => n.id);
}

/**
 * Compte total de notions dans toute la matière.
 */
function getTotalNotions() {
  return BAC_MATHEMATIQUES.chapitres.reduce((sum, c) => sum + c.notions.length, 0);
}

// ================================================================
// EXPORT
// ================================================================
module.exports = {
  BAC_MATHEMATIQUES,
  getChapitre,
  getNotion,
  getChapitres,
  getNotionsChapitre,
  getNotionsObligatoires,
  getTotalNotions
};
