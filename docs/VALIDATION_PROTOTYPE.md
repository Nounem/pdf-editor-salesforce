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

## Alignement visuel Salesforce

Le bandeau personnalisé, la police décorative, la palette propre à l’éditeur et les surcharges `--slds-c-button-*` ont été retirés. La carte, les badges, les icônes et les boutons de sélection de fichiers utilisent désormais les composants Lightning natifs. Le CSS des panneaux PDF référence les hooks globaux sémantiques du thème, avec des valeurs de repli. Aucun hook global Salesforce n’est redéfini par le composant.

Après cette refonte : compilation LWC réussie, 4 tests du modèle et 5 tests LWC réussis. Les quatre captures du README ont été régénérées avec le parcours complet texte, image et sauvegarde simulée. Les deux boutons de sélection de fichiers ouvrent le dialogue du navigateur ; un PDF local est également chargé. Le parcours vérifie l’absence de débordement horizontal de la page à 1 024 et 640 pixels de largeur.

Les adaptateurs de documentation donnent un aperçu du placement des contrôles ; ils ne reproduisent pas intégralement les composants Salesforce. La validation Apex indiquée plus haut est antérieure à cette refonte. Le rendu natif sous Cosmos/SLDS 2, les personnalisations de marque et la navigation clavier dans les contrôles natifs doivent être vérifiés en organisation cible.

## Page d’application pour Capitole Énergie

Ajout de `pdfEditorApp`, de la FlexiPage `PDF_Editor_App`, de l’onglet `PDF_Editor` et de sa visibilité dans `PDF_Editor_User`. Le sélecteur natif recherche un compte par défaut ; l’objet et son libellé sont configurables dans Lightning App Builder. L’éditeur reçoit l’identifiant sélectionné et conserve ses contrôles d’accès serveur.

Vérifications locales : 7 sources LWC compilées, 4 tests du modèle et 10 tests LWC réussis. Les nouveaux scénarios couvrent la sélection obligatoire, une sélection invalide, la transmission du contexte, le verrouillage du sélecteur pendant l’édition, l’annulation du changement d’enregistrement, la fermeture confirmée et le blocage pendant une sauvegarde.

Validation Salesforce en sandbox `optiTurpe` : `0AfAa00000qIdrOKAS`, statut `Succeeded`, `checkOnly=true`, 15 composants validés et 5 tests Apex réussis. L’organisation a été confirmée comme sandbox avant l’opération. La page, l’onglet et les permissions ont été acceptés par Salesforce ; aucun déploiement n’a été appliqué et l’application Capitole Énergie n’a pas été modifiée.

Après installation, vérifier la recherche réelle via `lightning-record-picker`, les permissions utilisateur, l’ouverture depuis la navigation de Capitole Énergie et le parcours PDF sous LWS. Les captures existantes du README montrent l’éditeur, pas le nouveau sélecteur de la page d’application.

## Déploiement de test dans la sandbox

Le 13 octobre 2026, à la demande de l’utilisateur, le projet a été effectivement déployé dans `optiTurpe`, après vérification de `Organization.IsSandbox=true`.

- Déploiement `0AfAa00000qIkJOKA0` : `Succeeded`, `checkOnly=false`, 16 composants déployés et 5 tests Apex réussis.
- Onglet `PDF_Editor` ajouté à l’application console existante `Capitole_Energie`, avec son entrée de navigation console.
- Permission Set `PDF_Editor_User` attribué avec succès à l’utilisateur connecté de la sandbox.
- Configuration relue après déploiement : présence du nouvel onglet, ordre des 11 onglets précédents conservé et 302 affectations de pages par profil conservées.

La sauvegarde de la configuration d’origine et les paquets de déploiement restent dans des dossiers locaux exclus de Git. Les réglages propres à cette organisation ne sont pas publiés dans le dépôt générique. Ce déploiement de test ne concerne pas la production.

## Ouverture locale, recherche multi-objets et diagnostic du moteur

Mise à jour du 13 octobre 2026 : la page ouvre désormais un PDF local sans compte obligatoire. La destination Salesforce peut être choisie après édition. Le choix d’objet inclut les objets standards pris en charge et les objets personnalisés disposant d’un champ `Name` lisible. Une confirmation protège les modifications d’une source Salesforce lors d’un changement de destination.

Le premier essai de déploiement a détecté une erreur de casse dans le filtre des objets standards. Les clés de `Schema.getGlobalDescribe()` sont en minuscules dans l’organisation testée ; elles sont désormais comparées à une liste normalisée. Le déploiement suivant `0AfAa00000qIto5KAC` a réussi (`checkOnly=false`, 6 tests Apex réussis). La lecture après installation confirme la présence de `Account`, `Contact`, `Opportunity`, `Quote` et `Compteur__c` parmi 159 objets éligibles pour l’utilisateur connecté. La lecture des PDF d’un compte accessible a réussi ; l’échantillon ne contenait aucun PDF.

Vérifications locales après correction du moteur :

- 7 sources LWC compilées, 4 tests du modèle et 18 tests LWC réussis.
- 6 tests navigateur réussis : 3 avec le moteur natif et les mêmes 3 sous `@locker/sandbox` 0.28.11, bibliothèque publiée par l’équipe sécurité Salesforce.
- Ouverture, texte accentué, image, masque, rotation, export idempotent, conservation des octets d’origine et refus des entrées non prises en charge vérifiés.
- Parcours réel LWC/moteur avec adaptateurs Salesforce : ouverture locale, édition, téléchargement valide, destination Compteur choisie sans perte d’ajouts et sauvegarde simulée ; 4 captures régénérées.
- Audit des dépendances de production : 0 vulnérabilité signalée. Ressource compilée : 2 131 061 octets.

Le moteur final et les messages de diagnostic ont ensuite été effectivement déployés dans `optiTurpe` : `0AfAa00000qIuCIKA0`, `Succeeded`, `checkOnly=false`, 4 composants mis à jour et 34 tests déclarés terminés par le rapport Salesforce, sans erreur. Les paramètres de sécurité ne faisaient pas partie de ce déploiement.

### Erreur signalée à l’ouverture de l’éditeur

Les paramètres récupérés de la sandbox montrent `lockerServiceNext=false` : l’organisation utilise Lightning Locker. Le moteur actuel nécessite LWS. Ce paramètre n’a pas été modifié ; il concerne l’ensemble des composants de l’organisation. Voir [la documentation Salesforce sur ce paramètre](https://developer.salesforce.com/docs/platform/lightning-components-security/guide/lws-enable-scratch-orgs.html).

Un second problème a été reproduit avec la bibliothèque locale LWS : `structuredClone` perd les propriétés du message PDF.js contenant des buffers transférables, puis peut refuser des objets proxifiés lors du rendu. Avant correction, l’ouverture ou le rendu attendait indéfiniment ; après injection d’un clonage JavaScript limité au bundle PDF, les 3 scénarios passent sous LWS. Les transferts de buffers sont ignorés puisque le moteur reste dans le même thread. Aucun global du navigateur ni paramètre de sécurité n’est remplacé.

L’interface identifie maintenant la phase en erreur (moteur ou liste de PDF), garde les détails disponibles et propose de réessayer. Une recherche en erreur ne bloque pas l’ouverture locale si le moteur est chargé. Les réponses obsolètes d’un ancien enregistrement sont ignorées.

**Limite de validation :** le navigateur automatisé connecté à l’organisation est redirigé vers l’écran Salesforce de changement de mot de passe. Il n’a donc pas permis de reproduire visuellement le message initial ni de valider la page native. Les tests LWS locaux ne remplacent pas la recette dans Capitole Énergie. L’activation de LWS et cette recette restent nécessaires ; aucune correction complète de l’erreur en organisation n’est revendiquée à ce stade.
