public with sharing class PdfEditorController {
    private static final Integer MAX_BYTES = 1000000;
    private static final Integer MAX_BASE64 = 1333336;

    public class FileInfo {
        @AuraEnabled public Id documentId;
        @AuraEnabled public Id versionId;
        @AuraEnabled public String title;
        @AuraEnabled public Integer size;
        public FileInfo(ContentVersion version) {
            documentId = version.ContentDocumentId;
            versionId = version.Id;
            title = version.Title;
            size = version.ContentSize;
        }
    }

    public class FileData {
        @AuraEnabled public String base64;
        @AuraEnabled public String title;
        @AuraEnabled public Id versionId;
    }

    public class SaveResult {
        @AuraEnabled public Id documentId;
        @AuraEnabled public Id versionId;
    }

    @AuraEnabled
    public static List<FileInfo> listRecordPdfs(Id recordId) {
        requireRecord(recordId);
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId FROM ContentDocumentLink
            WHERE LinkedEntityId = :recordId WITH USER_MODE LIMIT 200
        ]) documentIds.add(link.ContentDocumentId);
        List<FileInfo> result = new List<FileInfo>();
        if (documentIds.isEmpty()) return result;
        for (ContentVersion version : [
            SELECT Id, ContentDocumentId, Title, ContentSize FROM ContentVersion
            WHERE ContentDocumentId IN :documentIds AND IsLatest = true AND FileType = 'PDF'
            WITH USER_MODE ORDER BY LastModifiedDate DESC LIMIT 50
        ]) result.add(new FileInfo(version));
        return result;
    }

    @AuraEnabled
    public static FileData loadSmallPdf(Id recordId, Id versionId) {
        requireRecord(recordId);
        ContentVersion info = requireLinkedVersion(recordId, versionId);
        if (info.ContentSize > MAX_BYTES) throw problem('Ce PDF dépasse la limite de 1 Mo.');
        ContentVersion binary = [SELECT VersionData FROM ContentVersion WHERE Id = :versionId WITH USER_MODE LIMIT 1];
        FileData result = new FileData();
        result.base64 = EncodingUtil.base64Encode(binary.VersionData);
        result.title = info.Title;
        result.versionId = info.Id;
        return result;
    }

    @AuraEnabled
    public static SaveResult saveCopy(Id recordId, Id sourceVersionId, String title, String payload, String requestId) {
        requireRecord(recordId);
        if (sourceVersionId != null) requireLinkedVersion(recordId, sourceVersionId);
        if (String.isBlank(title) || title.length() > 100 || title.contains('/') || title.contains('\\')) {
            throw problem('Saisissez un nom de fichier de 1 à 100 caractères, sans séparateur de dossier.');
        }
        if (String.isBlank(requestId) || !Pattern.matches('[a-zA-Z0-9-]{16,64}', requestId)) {
            throw problem('Identifiant de sauvegarde invalide.');
        }
        if (String.isBlank(payload) || payload.length() > MAX_BASE64 || !payload.startsWith('JVBERi0')) {
            throw problem('Le résultat doit être un PDF de 1 Mo maximum.');
        }
        Blob data;
        try { data = EncodingUtil.base64Decode(payload); }
        catch (Exception error) { throw problem('Le contenu PDF reçu est invalide.'); }
        if (data.size() > MAX_BYTES) throw problem('Le résultat dépasse la limite de 1 Mo.');
        String cleanTitle = title.trim().replaceAll('(?i)\\.pdf$', '');
        if (String.isBlank(cleanTitle)) throw problem('Le nom de fichier est vide.');
        String key = UserInfo.getUserId() + ':' + requestId;
        String digest = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', data));
        String fingerprint = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(
            JSON.serialize(new List<String>{ String.valueOf(recordId), String.valueOf(sourceVersionId), cleanTitle, digest })
        )));
        SaveResult prior = previousResult(key, fingerprint);
        if (prior != null) return prior;

        Savepoint point = Database.setSavepoint();
        try {
            // Unique request key plus a single transaction prevent duplicate files.
            PDF_Edit_Operation__c operation = new PDF_Edit_Operation__c(
                RequestKey__c = key, PayloadHash__c = fingerprint,
                SourceVersionId__c = String.valueOf(sourceVersionId), TargetRecordId__c = String.valueOf(recordId)
            );
            // Internal idempotence ledger only. Users cannot edit its keys or results.
            // File access and all file writes remain strictly in USER_MODE.
            Database.insert(operation, AccessLevel.SYSTEM_MODE);
            ContentVersion output = new ContentVersion(
                Title = cleanTitle, PathOnClient = cleanTitle + '.pdf', VersionData = data,
                ReasonForChange = 'Copie éditée avec LovePdfSales'
            );
            Database.insert(output, AccessLevel.USER_MODE);
            ContentVersion saved = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :output.Id WITH USER_MODE];
            Database.insert(new ContentDocumentLink(ContentDocumentId = saved.ContentDocumentId,
                LinkedEntityId = recordId, ShareType = 'V', Visibility = 'InternalUsers'), AccessLevel.USER_MODE);
            operation.ResultVersionId__c = String.valueOf(saved.Id);
            Database.update(operation, AccessLevel.SYSTEM_MODE);
            SaveResult result = new SaveResult();
            result.versionId = saved.Id;
            result.documentId = saved.ContentDocumentId;
            return result;
        } catch (DmlException error) {
            Database.rollback(point);
            if (error.getDmlType(0) == StatusCode.DUPLICATE_VALUE) {
                SaveResult duplicate = previousResult(key, fingerprint);
                if (duplicate != null) return duplicate;
            }
            throw problem('Enregistrement impossible. Vérifiez vos droits sur les fichiers et les règles de validation, puis réessayez.');
        } catch (Exception error) {
            Database.rollback(point);
            throw problem('La copie n’a pas été enregistrée. Vous pouvez réessayer sans perdre vos modifications.');
        }
    }

    private static SaveResult previousResult(String key, String fingerprint) {
        Id actorId = UserInfo.getUserId();
        List<PDF_Edit_Operation__c> records = [
            SELECT PayloadHash__c, ResultVersionId__c FROM PDF_Edit_Operation__c
            WHERE RequestKey__c = :key AND CreatedById = :actorId WITH SYSTEM_MODE LIMIT 1
        ];
        if (records.isEmpty()) return null;
        if (records[0].PayloadHash__c != fingerprint) throw problem('Cette demande a déjà été utilisée avec un autre contenu.');
        if (String.isBlank(records[0].ResultVersionId__c)) throw problem('Sauvegarde en cours. Réessayez dans quelques instants.');
        Id versionId = (Id) records[0].ResultVersionId__c;
        List<ContentVersion> versions = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :versionId WITH USER_MODE];
        if (versions.isEmpty()) throw problem('La copie précédente a été supprimée ou n’est plus accessible.');
        SaveResult result = new SaveResult();
        result.versionId = versions[0].Id;
        result.documentId = versions[0].ContentDocumentId;
        return result;
    }

    private static ContentVersion requireLinkedVersion(Id recordId, Id versionId) {
        if (versionId == null || versionId.getSObjectType() != ContentVersion.SObjectType) throw problem('Version PDF invalide.');
        List<ContentVersion> versions = [
            SELECT Id, ContentDocumentId, Title, ContentSize, FileType FROM ContentVersion
            WHERE Id = :versionId WITH USER_MODE LIMIT 1
        ];
        if (versions.isEmpty() || versions[0].FileType != 'PDF') throw problem('PDF inaccessible.');
        Id documentId = versions[0].ContentDocumentId;
        List<ContentDocumentLink> links = [
            SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId = :recordId AND ContentDocumentId = :documentId
            WITH USER_MODE LIMIT 1
        ];
        if (links.isEmpty()) throw problem('Ce PDF n’est pas lié à cet enregistrement ou vous n’y avez pas accès.');
        return versions[0];
    }

    private static void requireRecord(Id recordId) {
        if (recordId == null) throw problem('Ouvrez l’éditeur depuis une page d’enregistrement.');
        Schema.DescribeSObjectResult description = recordId.getSObjectType().getDescribe();
        if (!description.isAccessible() || !description.isQueryable()) throw problem('Enregistrement inaccessible.');
        List<SObject> records = Database.queryWithBinds(
            'SELECT Id FROM ' + description.getName() + ' WHERE Id = :target LIMIT 1',
            new Map<String, Object>{ 'target' => recordId }, AccessLevel.USER_MODE
        );
        if (records.isEmpty()) throw problem('Enregistrement inaccessible.');
    }

    private static AuraHandledException problem(String message) {
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
    }
}
