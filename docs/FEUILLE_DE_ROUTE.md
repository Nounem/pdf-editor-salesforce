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

Décisions du 19 octobre 2026 : **« Nouvelle version du fichier » par défaut** ; **Opportunité** en priorité (objet le plus utilisé).

- [x] Action « Modifier un PDF » sur l’Opportunité (à placer dans la présentation de page, voir README)
- [x] Choix de l’enregistrement appliqué immédiatement, Opportunité présélectionnée (« Utiliser / Changer / Annuler » supprimés)
- [x] « Nouvelle version du fichier » (par défaut) / « Nouveau fichier » / « Télécharger »

## Lot 1 — L’essentiel

- [x] Signature dessinée (réutilisable pendant la session)
- [x] Tampons : Bon pour accord, Lu et approuvé, Copie conforme, Payé, date du jour, nom de l’utilisateur
- [x] Cases ✓ / ✗ et surligneur
- [x] Texte multiligne, gras, 3 polices
- [x] Raccourcis Ctrl+Z / Ctrl+Y / Suppr / Échap
- [x] Zoom « Ajuster à la largeur »

## Performance (20 octobre 2026)

- [x] Moteur PDF chargé à la première ouverture d’un PDF, préchargé au survol (sous LWS : ~8,7 s évitées à l’affichage)
- [x] Liste des objets en describe différé (0,4 s au lieu de 0,8 à 2,3 s)

## Lot 2 — Gain de temps

- [x] Champs de l’enregistrement à insérer (valeurs formatées, noms des enregistrements liés)
- [x] Déplacer et extraire une page, ajouter les pages d’un autre PDF
- [x] Brouillon conservé sur le poste (7 jours, effacé après enregistrement)
- [x] Objets Contrat, Commande, Contrat de service (les objets personnalisés étaient déjà proposés)

## Lot 3 — Plus tard

- [ ] Remplissage des formulaires PDF
- [ ] Envoi par e-mail
- [ ] Limite au-delà de 1 Mo, après mesure dans l’organisation
