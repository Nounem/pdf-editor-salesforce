public with sharing class PdfEditorController {
    private static final Integer MAX_BYTES = 1000000;
    private static final Integer MAX_BASE64 = 1333336;

    public class ObjectChoice {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        public ObjectChoice(Schema.DescribeSObjectResult description) {
            label = description.getLabel();
            value = description.getName();
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<ObjectChoice> listRecordObjects() {
        Set<String> standardObjects = new Set<String>{
            'account', 'contact', 'opportunity', 'lead', 'quote',
            'asset', 'campaign', 'product2', 'pricebook2', 'order', 'servicecontract'
        };
        Map<String, Schema.SObjectType> types = Schema.getGlobalDescribe();
        List<ObjectChoice> result = new List<ObjectChoice>();
        for (String name : types.keySet()) {
            if (name == 'PDF_Edit_Operation__c') continue;
            // Include business custom objects, not metadata, events or history tables.
            // Global describe keys can be lowercase; Set membership is case-sensitive.
            if (!standardObjects.contains(name.toLowerCase()) && !name.endsWith('__c')) continue;
            // Deferred describes skip field metadata: about 2 to 6 times faster in large orgs.
            Schema.DescribeSObjectResult description = types.get(name).getDescribe(SObjectDescribeOptions.DEFERRED);
            if (!description.isAccessible() || !description.isQueryable() || description.isCustomSetting()) continue;
            // Custom objects always have a Name field; standard ones may not (Contract uses its number),
            // and the record picker searches by Name. Only the few standard objects are checked.
            if (!description.isCustom()) {
                Schema.SObjectField nameField = description.fields.getMap().get('Name');
                if (nameField == null || !nameField.getDescribe().isAccessible()) continue;
            }
            result.add(new ObjectChoice(description));
        }
        return result;
    }

    public class FieldValue implements Comparable {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        public FieldValue(String label, String value) {
            this.label = label;
            this.value = value;
        }
        public Integer compareTo(Object other) {
            return label.compareTo(((FieldValue) other).label);
        }
    }

    private static final Integer MAX_FIELDS = 80;
    private static final Set<String> SKIPPED_FIELDS = new Set<String>{
        'systemmodstamp', 'lastvieweddate', 'lastreferenceddate', 'lastactivitydate', 'lastmodifieddate', 'isdeleted'
    };
    private static final Set<Schema.DisplayType> VALUE_TYPES = new Set<Schema.DisplayType>{
        Schema.DisplayType.STRING, Schema.DisplayType.TEXTAREA, Schema.DisplayType.PICKLIST, Schema.DisplayType.MULTIPICKLIST,
        Schema.DisplayType.COMBOBOX, Schema.DisplayType.EMAIL, Schema.DisplayType.PHONE, Schema.DisplayType.URL,
        Schema.DisplayType.DATE, Schema.DisplayType.DATETIME, Schema.DisplayType.CURRENCY, Schema.DisplayType.DOUBLE,
        Schema.DisplayType.INTEGER, Schema.DisplayType.LONG, Schema.DisplayType.PERCENT
    };

    // Readable, non-empty values of the record, formatted for the user, to insert into a PDF.
    // Lookups give the related record's name (for example the account of an opportunity).
    @AuraEnabled
    public static List<FieldValue> listRecordFields(Id recordId) {
        requireRecord(recordId);
        Schema.DescribeSObjectResult description = recordId.getSObjectType().getDescribe();
        Map<String, String> labels = new Map<String, String>();
        Map<String, Schema.DisplayType> types = new Map<String, Schema.DisplayType>();
        List<String> columns = new List<String>();
        for (Schema.SObjectField field : description.fields.getMap().values()) {
            if (columns.size() >= MAX_FIELDS) break;
            Schema.DescribeFieldResult info = field.getDescribe();
            if (!info.isAccessible() || SKIPPED_FIELDS.contains(info.getName().toLowerCase()) || info.isHtmlFormatted()) continue;
            Schema.DisplayType type = info.getType();
            if (type == Schema.DisplayType.REFERENCE) {
                String path = relatedName(info);
                if (path == null) continue;
                // « Owner ID » reads « Owner »: the value shown is the related record's name.
                labels.put(path, info.getLabel().removeEndIgnoreCase(' ID'));
                types.put(path, Schema.DisplayType.STRING);
                columns.add(path);
            } else if (VALUE_TYPES.contains(type) && (type != Schema.DisplayType.TEXTAREA || info.getLength() <= 1000)) {
                String name = info.getName();
                labels.put(name, info.getLabel());
                types.put(name, type);
                // Picklists are read in the user's language rather than as API values.
                columns.add(type == Schema.DisplayType.PICKLIST || type == Schema.DisplayType.MULTIPICKLIST ? 'toLabel(' + name + ')' : name);
            }
        }
        List<FieldValue> result = new List<FieldValue>();
        if (columns.isEmpty()) return result;
        Boolean multiCurrency = description.fields.getMap().containsKey('CurrencyIsoCode');
        if (multiCurrency) columns.add('CurrencyIsoCode');
        SObject record = Database.queryWithBinds(
            'SELECT ' + String.join(columns, ', ') + ' FROM ' + description.getName() + ' WHERE Id = :target LIMIT 1',
            new Map<String, Object>{ 'target' => recordId }, AccessLevel.USER_MODE
        )[0];
        String currencyCode = multiCurrency ? (String) record.get('CurrencyIsoCode') : UserInfo.getDefaultCurrency();
        FieldValue nameValue;
        for (String path : labels.keySet()) {
            Object raw;
            if (path.contains('.')) {
                SObject parent = record.getSObject(path.substringBefore('.'));
                raw = parent == null ? null : parent.get('Name');
            } else {
                raw = record.get(path);
            }
            String value = format(raw, types.get(path), currencyCode);
            if (String.isBlank(value)) continue;
            FieldValue item = new FieldValue(labels.get(path), value);
            if (path == 'Name') nameValue = item; else result.add(item);
        }
        result.sort();
        if (nameValue != null) result.add(0, nameValue);
        return result;
    }

    private static String relatedName(Schema.DescribeFieldResult info) {
        String relationship = info.getRelationshipName();
        List<Schema.SObjectType> targets = info.getReferenceTo();
        if (relationship == null || targets.isEmpty()) return null;
        Schema.DescribeSObjectResult target = targets[0].getDescribe(SObjectDescribeOptions.DEFERRED);
        if (!target.isAccessible()) return null;
        Schema.SObjectField nameField = target.fields.getMap().get('Name');
        if (nameField == null) return null;
        Schema.DescribeFieldResult nameInfo = nameField.getDescribe();
        return nameInfo.isAccessible() && nameInfo.isNameField() ? relationship + '.Name' : null;
    }

    private static String format(Object value, Schema.DisplayType type, String currencyCode) {
        if (value == null) return null;
        if (value instanceof Date) return ((Date) value).format();
        if (value instanceof Datetime) return ((Datetime) value).format();
        if (type == Schema.DisplayType.CURRENCY) return ((Decimal) value).setScale(2).format() + ' ' + currencyCode;
        if (type == Schema.DisplayType.PERCENT) return ((Decimal) value).format() + ' %';
        if (value instanceof Decimal) return ((Decimal) value).format();
        return String.valueOf(value);
    }

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
        Blob data = requirePdf(payload, requestId);
        String cleanTitle = title.trim().replaceAll('(?i)\\.pdf$', '');
        if (String.isBlank(cleanTitle)) throw problem('Le nom de fichier est vide.');
        ContentVersion output = new ContentVersion(
            Title = cleanTitle, PathOnClient = cleanTitle + '.pdf', VersionData = data,
            ReasonForChange = 'Copie éditée avec LovePdfSales'
        );
        return persist(recordId, sourceVersionId, requestId, new List<String>{ 'copy', cleanTitle }, output, true);
    }

    // Adds the edited PDF as the latest version of its source file: history stays in Salesforce Files.
    @AuraEnabled
    public static SaveResult saveNewVersion(Id recordId, Id sourceVersionId, String payload, String requestId) {
        requireRecord(recordId);
        ContentVersion source = requireLinkedVersion(recordId, sourceVersionId);
        Blob data = requirePdf(payload, requestId);
        String key = UserInfo.getUserId() + ':' + requestId;
        // A retry after a lost response must not be refused because its own version is now the latest.
        if (!source.IsLatest && [SELECT count() FROM PDF_Edit_Operation__c WHERE RequestKey__c = :key WITH SYSTEM_MODE] == 0) {
            throw problem('Ce fichier a reçu une nouvelle version depuis son ouverture. Rouvrez-le pour repartir de la dernière version.');
        }
        ContentVersion output = new ContentVersion(
            ContentDocumentId = source.ContentDocumentId, Title = source.Title, PathOnClient = source.Title + '.pdf',
            VersionData = data, ReasonForChange = 'Modifié avec LovePdfSales'
        );
        return persist(recordId, sourceVersionId, requestId, new List<String>{ 'version' }, output, false);
    }

    private static Blob requirePdf(String payload, String requestId) {
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
        return data;
    }

    private static SaveResult persist(Id recordId, Id sourceVersionId, String requestId, List<String> details, ContentVersion output, Boolean linkToRecord) {
        String key = UserInfo.getUserId() + ':' + requestId;
        String digest = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', output.VersionData));
        List<String> parts = new List<String>{ String.valueOf(recordId), String.valueOf(sourceVersionId), digest };
        parts.addAll(details);
        String fingerprint = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(JSON.serialize(parts))));
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
            Database.insert(output, AccessLevel.USER_MODE);
            ContentVersion saved = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :output.Id WITH USER_MODE];
            if (linkToRecord) {
                Database.insert(new ContentDocumentLink(ContentDocumentId = saved.ContentDocumentId,
                    LinkedEntityId = recordId, ShareType = 'V', Visibility = 'InternalUsers'), AccessLevel.USER_MODE);
            }
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
            // Keep the real cause (trigger, validation rule, access) visible to users and admins.
            System.debug(LoggingLevel.ERROR, 'PdfEditorController.persist ' + error.getDmlType(0) + ': ' + error.getDmlMessage(0));
            if (!linkToRecord && error.getDmlType(0) == StatusCode.INSUFFICIENT_ACCESS_OR_READONLY) {
                throw problem('Vous ne pouvez pas modifier ce fichier. Enregistrez plutôt un nouveau fichier. Vos modifications sont conservées.');
            }
            throw problem('Enregistrement impossible : ' + error.getDmlMessage(0) + ' Vos modifications sont conservées.');
        } catch (Exception error) {
            Database.rollback(point);
            System.debug(LoggingLevel.ERROR, 'PdfEditorController.persist ' + error.getTypeName() + ': ' + error.getMessage());
            throw problem('La copie n’a pas été enregistrée (' + error.getMessage() + '). Vous pouvez réessayer sans perdre vos modifications.');
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
            SELECT Id, ContentDocumentId, Title, ContentSize, FileType, IsLatest FROM ContentVersion
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
