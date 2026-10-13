# PDF Editor

Prototype d’éditeur PDF en Lightning Web Component. Il permet de compléter un PDF depuis une page d’enregistrement Salesforce, puis d’enregistrer **une copie** dans Salesforce Files.

## Comment ça fonctionne

Les captures suivantes montrent le **composant LWC réel et son moteur PDF dans un aperçu local**, avec un devis fictif. Les contrôles Lightning et les appels Salesforce sont simulés pour cette démonstration ; ce ne sont pas des captures d’une organisation de production.

### 1. Ouvrir un PDF

Choisir un fichier lié à l’enregistrement dans la liste, puis cliquer sur **Ouvrir**, ou sélectionner un PDF avec **Depuis mon ordinateur**.

![Écran d’accueil avec sélection d’un PDF Salesforce ou ouverture d’un fichier local](docs/screenshots/01-ouvrir-un-pdf.png)

### 2. Ajouter et modifier du texte

Cliquer sur **Texte**, puis sur la page ou sur **Placer l’outil au centre**. Le panneau **Propriétés** permet de saisir la mention, régler sa taille et sa couleur, et ajuster sa position. Ici, « Bon pour accord » est ajouté au devis.

![Devis avec la mention Bon pour accord et le panneau de propriétés du texte](docs/screenshots/02-ajouter-du-texte.png)

### 3. Ajouter une image

Cliquer sur **Image**, sélectionner un PNG ou JPEG, puis le placer dans le document. Déplacer son cadre ou ajuster les coordonnées, la largeur et la hauteur dans **Propriétés**. L’exemple utilise un tampon fictif « VALIDÉ ».

![Ajout d’un tampon image au devis avec réglage de sa position et de ses dimensions](docs/screenshots/03-ajouter-une-image.png)

### 4. Enregistrer une copie

Choisir le **Nom de la copie**, puis cliquer sur **Enregistrer une copie**. Dans Salesforce, le nouveau PDF est lié à l’enregistrement courant et le bouton **Voir la copie** ouvre son aperçu. La capture ci-dessous illustre le message de réussite avec une **sauvegarde simulée localement** ; aucun fichier n’est envoyé à Salesforce par la démonstration.

![Message de confirmation illustrant la sauvegarde simulée d’une copie du PDF modifié](docs/screenshots/04-enregistrer-une-copie.png)

## Déployer en production

[![Déployer PDF Editor dans Salesforce — Production](https://raw.githubusercontent.com/afawcett/githubsfdeploy/master/deploy.png)](https://githubsfdeploy.herokuapp.com/?owner=Nounem&repo=pdf-editor-salesforce)

Le bouton ouvre **GitHub Salesforce Deploy Tool**, avec la cible **Production / Developer** sélectionnée par défaut. Le déploiement s’effectue dans l’organisation à laquelle vous vous connectez, après confirmation dans l’outil.

1. Publier ce projet dans [Nounem/pdf-editor-salesforce](https://github.com/Nounem/pdf-editor-salesforce) avec `sfdx-project.json` et `force-app` à la racine. Inclure la ressource compilée `force-app/main/default/staticresources/lovePdfEngine.resource` et toutes les métadonnées ; aucune compilation npm n’est effectuée par le bouton.
2. Cliquer sur le bouton : **Owner** (`Nounem`) et **Repository** (`pdf-editor-salesforce`) sont préremplis. Conserver **Production / Developer**, préciser éventuellement **Branch/Tag/Commit**, puis se connecter à l’organisation de production souhaitée.
3. Vérifier les composants proposés et lancer **Deploy**. Les exigences de tests Apex et de couverture de Salesforce restent applicables en production.
4. Après le déploiement, attribuer le Permission Set **LovePdfSales — Éditeur PDF** aux utilisateurs concernés et ajouter le composant à leur page d’enregistrement dans Lightning App Builder.

**Source du déploiement :** le bouton utilise le dépôt [Nounem/pdf-editor-salesforce](https://github.com/Nounem/pdf-editor-salesforce). Les fichiers à déployer doivent y être publiés ; les modifications présentes uniquement sur votre ordinateur ne sont pas récupérées par le bouton.

L’outil est un service tiers qui demande une autorisation Salesforce pour déployer les métadonnées. Il prend en charge le répertoire par défaut des projets Salesforce DX. [Documentation de GitHub Salesforce Deploy Tool](https://github.com/afawcett/githubsfdeploy).

La validation actuelle porte sur le prototype en sandbox ; la recette de l’interface sous Lightning Web Security reste décrite dans [les résultats de validation](docs/VALIDATION_PROTOTYPE.md).

## Fonctionnalités développées

- Ouvrir un PDF lié à l’enregistrement ou un fichier local.
- Ajouter une ligne de texte, modifier sa taille, sa couleur et sa position.
- Ajouter des images PNG/JPEG et régler leurs dimensions.
- Ajouter un rectangle blanc de **masquage visuel**.
- Sélectionner et déplacer les ajouts à la souris, au clavier ou avec leurs coordonnées.
- Supprimer un ajout, annuler/rétablir les 50 dernières commandes.
- Parcourir, tourner et retirer des pages.
- Enregistrer une copie liée à l’enregistrement courant, avec réessai idempotent.

L’aperçu est généré à partir du PDF exporté. Les bibliothèques sont embarquées en Static Resource : aucun service PDF externe ni CDN n’est utilisé.

## Limites du prototype

**1 000 000 octets** en entrée et en sortie, **20 pages**, **100 ajouts**. Images : 500 000 octets et 8 millions de pixels au maximum. Une image peut faire dépasser la limite de sortie.

- Le masquage blanc ne supprime pas les informations sous-jacentes. Il ne permet pas de caviarder des données confidentielles.
- Les PDF chiffrés, avec signature/champ de signature, formulaires interactifs, annotations ou liens interactifs sont refusés avant édition.
- Ajout de texte latin en Helvetica, une ligne de 200 caractères au maximum. Pas d’édition du texte d’origine, d’OCR, de fusion ni de réorganisation des pages dans cette version.
- Les ajouts restent éditables pendant la session. Après fermeture, ils sont intégrés au contenu du PDF ; le projet d’édition n’est pas conservé.
- Le moteur PDF.js fonctionne dans le thread principal pour éviter les workers et imports dynamiques sous LWS. Cela reste à qualifier en interface Lightning dans l’org cible.
- Seuls les utilisateurs internes et Lightning Experience sur ordinateur sont ciblés. Les copies sont liées au record avec une visibilité `InternalUsers`.
- Les grands fichiers, polices/CMaps particuliers, PDF/A et l’accessibilité du PDF produit restent hors garantie du prototype.

## Installer dans une sandbox

Les ressources compilées et les métadonnées sont déjà dans `force-app`. La cible locale observée pendant le développement est `optiTurpe`, confirmée comme sandbox. Le code est validé avec `--dry-run` ; cette commande n’active pas le composant.

```powershell
sf project deploy start --target-org optiTurpe --source-dir force-app --test-level RunSpecifiedTests --tests PdfEditorControllerTest --wait 10
sf org assign permset --target-org optiTurpe --name PDF_Editor_User
```

Dans Lightning App Builder, modifier une page d’enregistrement, placer **LovePdfSales — Éditeur PDF** dans une zone large, puis enregistrer/activer cette page pour les testeurs. L’identifiant de l’enregistrement est fourni automatiquement au composant.

Le Permission Set donne accès au contrôleur. Les utilisateurs doivent aussi disposer des droits habituels de lecture sur les enregistrements et de création/partage de fichiers. Le composant ne contourne pas ces droits. L’objet de suivi des requêtes est interne ; il n’est pas destiné à être modifié par les utilisateurs.

## Construire et tester

Node.js 22 récent ou ultérieur, npm, Salesforce CLI. Les tests navigateur utilisent Edge installé sur Windows.

```powershell
npm ci
npm run build
npm run check
npm test
npm run test:browser
sf project deploy start --dry-run --target-org optiTurpe --source-dir force-app --test-level RunSpecifiedTests --tests PdfEditorControllerTest --wait 10
```

- `build` assemble PDF.js et pdf-lib en une ressource statique d’environ 2,13 Mo et génère les notices de licence.
- `check` compile les sources LWC.
- `test` vérifie le modèle d’édition et l’interface avec les stubs Salesforce.
- `test:browser` exécute le vrai moteur PDF dans Edge avec une CSP qui interdit les workers et les scripts externes. Ces tests ne reproduisent pas Lightning Web Security.
- Les tests Apex vérifient lecture, copie, réessai, rejets et accès à un fichier privé. Ils utilisent des fichiers minimaux pour les contrôles serveur ; les tests navigateur couvrent le parsing/export réel.

Pour régénérer les quatre captures à partir du composant et du moteur compilé : `npm run docs:screenshots`. Le script utilise Edge en mode sans interface, des données fictives et des adaptateurs locaux ; il n’appelle aucune organisation Salesforce.

## Organisation du code

| Fichier / dossier | Rôle |
|---|---|
| `force-app/main/default/lwc/pdfEditor/` | Interface et coordination des appels Salesforce |
| `force-app/main/default/lwc/pdfEditState/` | État, commandes, historique, encodage binaire |
| `scripts/engine-entry.js` | Adaptateur PDF.js/pdf-lib et refus des formats hors périmètre |
| `force-app/main/default/classes/PdfEditorController.cls` | Contrôles d’accès et transactions Files |
| `force-app/main/default/objects/PDF_Edit_Operation__c/` | Suivi interne des requêtes idempotentes |
| `tests/` | Tests du modèle et du moteur navigateur |

Les requêtes et écritures Files sont en mode utilisateur. Seul le journal interne d’idempotence est accédé en mode système, avec une clé incluant l’utilisateur et un filtre sur l’auteur. Chaque restitution de fichier repasse par un contrôle d’accès en mode utilisateur. La création du fichier, son lien et la trace sont transactionnels.

## Étape suivante

Le détail des résultats exécutés est conservé dans [docs/VALIDATION_PROTOTYPE.md](docs/VALIDATION_PROTOTYPE.md).

Effectuer la recette **dans une page Lightning avec LWS activé**, notamment : chargement du bundle, ajout et déplacement, rendu des accents/images, copie et lecture par un utilisateur non administrateur, coupure réseau, déclencheurs de l’organisation et mesure du heap près du seuil de 1 Mo. Ne pas augmenter ce seuil sans mesure.

L’étude initiale et la modélisation restent disponibles dans [ETUDE_FAISABILITE_EDITEUR_PDF_LWC.md](ETUDE_FAISABILITE_EDITEUR_PDF_LWC.md). Les dépendances sont documentées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
