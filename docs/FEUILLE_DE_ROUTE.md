# Feuille de route — éditeur PDF simplifié

Validée le 19 octobre 2026. Objectif : un éditeur utilisable par tous, en 3 étapes : **Ouvrir → Modifier → Enregistrer**.

## Parcours cible

1. **Ouvrir** — action rapide « Modifier un PDF » sur l’enregistrement (liste directe de ses PDF), ou onglet « Éditeur PDF » pour un fichier de l’ordinateur. L’enregistrement n’est demandé qu’au moment d’enregistrer dans Salesforce.
2. **Modifier** — une barre d’outils : Texte · Signature · Tampon · Image · Case ✓/✗ · Surligner · Masquer, avec les miniatures des pages.
3. **Enregistrer** — un seul bouton : nouvelle version du fichier (par défaut), nouveau fichier sur l’enregistrement, ou téléchargement.

## Phase 1 — Corriger le fonctionnement

- [x] `npm run check` ne plante plus sur `lwc/jsconfig.json`
- [x] Erreurs Apex détaillées et tracées (cause réelle d’un échec de sauvegarde)
- [x] Le document n’est « modifié » qu’après une vraie modification
- [x] Aperçu en direct : le PDF source est rendu une fois, les ajouts sont affichés par-dessus ; le PDF n’est fabriqué qu’au téléchargement ou à l’enregistrement
- [x] Plus de blocage général de l’interface pendant l’affichage (clavier et champs restent utilisables)
- [x] Ajouts orientés selon la rotation de la page
- [x] PDF avec liens/annotations et petites imperfections acceptés
- [x] Poignée de redimensionnement à la souris
- [x] Message exact quand le moteur n’est pas prêt

## Phase 2 — Simplifier le parcours

- [ ] Action rapide « Modifier un PDF » sur les pages d’enregistrement
- [ ] Choix de l’enregistrement seulement à l’enregistrement (supprimer « Changer d’enregistrement »)
- [ ] « Nouvelle version du fichier » / « Nouveau fichier » / « Télécharger »

## Lot 1 — L’essentiel

- [ ] Signature dessinée
- [ ] Tampons : Bon pour accord, Lu et approuvé, date du jour, nom de l’utilisateur, Copie conforme
- [ ] Cases ✓ / ✗ et surligneur
- [ ] Texte multiligne, gras, 3 polices
- [ ] Raccourcis Ctrl+Z / Ctrl+Y / Suppr
- [ ] Zoom « Ajuster à la largeur »

## Lot 2 — Gain de temps

- [ ] Champs automatiques de l’enregistrement (nom du compte, n° de contrat…)
- [ ] Réorganiser, extraire, fusionner des pages
- [ ] Brouillon conservé sur le poste
- [ ] Objets Contrat, Commande et objets métier Capitole Énergie

## Lot 3 — Plus tard

- [ ] Remplissage des formulaires PDF
- [ ] Envoi par e-mail
- [ ] Limite au-delà de 1 Mo, après mesure dans l’organisation
