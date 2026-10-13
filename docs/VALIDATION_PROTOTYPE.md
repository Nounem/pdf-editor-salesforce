# Validation du prototype 0.1.0

Date : 13 octobre 2026.

## Résultats observés

| Vérification | Résultat |
|---|---|
| Compilation LWC locale | 4 fichiers JS/HTML/CSS compilés |
| Modèle d’édition | 4 tests réussis |
| Interface LWC avec stubs Salesforce | 5 tests réussis |
| Moteur PDF réel dans Edge | 3 tests réussis |
| Validation de déploiement dans `optiTurpe` | Réussie, sans appliquer le déploiement |
| Tests Apex exécutés pendant la validation | 5 tests réussis |
| Couverture de `PdfEditorController` | 103 emplacements couverts sur 114, soit 90,35 % |
| Taille de la Static Resource | 2 126 905 octets |
| Audit npm des dépendances de production | Aucun avis de vulnérabilité retourné lors de la vérification |

Validation Salesforce : `0AfAa00000qIekEKAS`, statut `Succeeded`, `checkOnly=true`. La cible a été vérifiée comme sandbox via `Organization.IsSandbox`. Aucun composant n’a été activé sur une page d’enregistrement et aucun Permission Set n’a été attribué à un utilisateur réel.

## Ce que les tests démontrent

- Annuler/rétablir, supprimer une page et protéger la dernière page.
- Encoder/décoder un million d’octets en JavaScript sans corruption.
- Charger un fichier via les appels LWC simulés, ajouter/modifier/supprimer un texte et empêcher une sauvegarde sur un autre enregistrement après navigation.
- Conserver la clé de requête lors d’un réessai après erreur réseau.
- Exporter texte accentué, image et masque ; tourner une page ; ne pas modifier les octets d’origine ; produire les mêmes octets pour un export répété.
- Rendre ce résultat dans Edge avec une CSP sans worker ni scripts externes.
- Refuser les entrées invalides, caractères non supportés et formulaires interactifs dans les scénarios testés.
- Lire un fichier Salesforce lié, créer une copie avec lien `InternalUsers` et ne pas créer de doublon sur une requête répétée.
- Refuser les références non liées, les demandes incohérentes et l’accès à un fichier privé par un autre utilisateur.

## Ce qui reste à qualifier

La compilation Salesforce et les tests navigateur locaux ne prouvent pas la compatibilité du bundle dans le bac à sable JavaScript de Lightning Web Security. Une recette sur une page Lightning reste nécessaire après installation.

Les limites de 1 Mo et 20 pages sont des garde-fous du prototype, pas des capacités garanties dans toute organisation. Mesurer le heap réel des échanges LWC/Apex et les coûts des automatisations avant de les conserver ou de les relever.

Le corpus actuel est synthétique. Compléter avec les PDF métier, les formats d’image, les polices et les conditions de partage effectivement utilisés. La conservation PDF/A, les PDF balisés, les sources complexes et l’accessibilité du document produit ne sont pas validées.

Le premier lot livre l’enrichissement et la sauvegarde d’une copie. L’édition du texte d’origine, le caviardage irréversible, la réédition persistante, la fusion et le réordonnancement restent à développer ou à intégrer via un moteur spécialisé.

## Parcours visuel de documentation

Les captures de `docs/screenshots/` sont produites avec `npm run docs:screenshots` : le véritable composant LWC et le bundle PDF s’exécutent ensemble dans Edge, avec des contrôles Lightning simplifiés et des appels Apex simulés. Le script ouvre un devis fictif, ajoute et repositionne une mention et un tampon, puis vérifie la production d’un PDF lors de la sauvegarde simulée. Aucune organisation Salesforce n’est appelée.

Ce parcours a mis en évidence une incompatibilité avec la méthode `convertToViewportRectangle`, absente du viewport PDF.js utilisé. Le composant calcule désormais son cadre de sélection à partir de deux appels à `convertToViewportPoint`. La compilation LWC, les quatre tests du modèle et les cinq tests d’interface ont été relancés avec succès après cette correction. La recette sous Lightning Web Security reste distincte.
