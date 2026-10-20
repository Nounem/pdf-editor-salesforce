@IsTest
private class PdfEditorControllerTest {
    private static String pdf() { return EncodingUtil.base64Encode(Blob.valueOf('%PDF-1.4\n%%EOF')); }
    @TestSetup
    static void setup() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Id permissionId = [SELECT Id FROM PermissionSet WHERE Name = 'PDF_Editor_User' LIMIT 1].Id;
            if ([SELECT count() FROM PermissionSetAssignment WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSetId = :permissionId] == 0) {
                insert new PermissionSetAssignment(AssigneeId = UserInfo.getUserId(), PermissionSetId = permissionId);
            }
        }
        Account account = new Account(Name = 'LovePdf test');
        insert account;
        insert new ContentVersion(Title = 'Source', PathOnClient = 'source.pdf', VersionData = Blob.valueOf('%PDF-1.4\n%%EOF'), FirstPublishLocationId = account.Id);
    }

    @IsTest
    static void listsReadableBusinessObjects() {
        Test.startTest();
        List<PdfEditorController.ObjectChoice> choices = PdfEditorController.listRecordObjects();
        Test.stopTest();
        Set<String> names = new Set<String>();
        Map<String, Schema.SObjectType> types = Schema.getGlobalDescribe();
        for (PdfEditorController.ObjectChoice choice : choices) {
            System.assert(!String.isBlank(choice.label));
            System.assert(names.add(choice.value), 'No duplicate objects');
            Schema.DescribeSObjectResult description = types.get(choice.value).getDescribe();
            System.assert(description.isAccessible() && description.isQueryable());
            System.assert(description.fields.getMap().get('Name').getDescribe().isAccessible());
        }
        System.assert(names.contains('Account'));
        System.assert(names.contains('Contact'));
        System.assert(names.contains('Opportunity'));
        System.assert(!names.contains('PDF_Edit_Operation__c'), 'Internal journal must not be offered');
        System.assert(!names.contains('ContentVersion'), 'Technical objects must not be offered');
    }

    @IsTest
    static void listsFormattedRecordValuesIncludingRelatedNames() {
        // Accounts avoid org-specific opportunity validation rules; a child account exercises lookups.
        Account parent = [SELECT Id FROM Account LIMIT 1];
        Account child = new Account(Name = 'Filiale LovePdf', ParentId = parent.Id, AnnualRevenue = 1700, Phone = '0102030405');
        insert child;
        Test.startTest();
        List<PdfEditorController.FieldValue> values = PdfEditorController.listRecordFields(child.Id);
        Test.stopTest();
        Set<String> found = new Set<String>();
        Boolean amountFound = false;
        for (PdfEditorController.FieldValue item : values) {
            System.assert(String.isNotBlank(item.label) && String.isNotBlank(item.value), 'Only labelled, non-empty values');
            found.add(item.value);
            if (item.value.endsWith(' ' + UserInfo.getDefaultCurrency())) amountFound = true;
        }
        System.assertEquals('Filiale LovePdf', values[0].value, 'The record name comes first');
        System.assert(found.contains('LovePdf test'), 'The parent account name is offered for the lookup');
        System.assert(found.contains('0102030405'), 'Phone numbers are offered');
        System.assert(amountFound, 'Currency amounts are shown with their currency');
    }

    @IsTest
    static void loadsAndCreatesOnlyOneCopyOnRetry() {
        Account account = [SELECT Id FROM Account LIMIT 1];
        Test.startTest();
        List<PdfEditorController.FileInfo> files = PdfEditorController.listRecordPdfs(account.Id);
        System.assertEquals(1, files.size());
        PdfEditorController.FileData loaded = PdfEditorController.loadSmallPdf(account.Id, files[0].versionId);
        System.assertEquals(pdf(), loaded.base64);
        PdfEditorController.SaveResult first = PdfEditorController.saveCopy(account.Id, loaded.versionId, 'Copie', pdf(), 'request-00000000001');
        PdfEditorController.SaveResult retry = PdfEditorController.saveCopy(account.Id, loaded.versionId, 'Copie', pdf(), 'request-00000000001');
        Test.stopTest();
        System.assertEquals(first.versionId, retry.versionId);
        System.assertNotEquals(files[0].documentId, first.documentId);
        System.assertEquals(2, [SELECT count() FROM ContentVersion]);
        System.assertEquals(1, [SELECT count() FROM PDF_Edit_Operation__c WITH SYSTEM_MODE]);
        System.assertEquals(1, [SELECT count() FROM ContentDocumentLink WHERE ContentDocumentId = :first.documentId AND LinkedEntityId = :account.Id]);
        System.assertEquals('InternalUsers', [SELECT Visibility FROM ContentDocumentLink WHERE ContentDocumentId = :first.documentId AND LinkedEntityId = :account.Id].Visibility);
    }

    @IsTest
    static void savesANewVersionOfTheSourceFileOnlyOnceOnRetry() {
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion source = [SELECT Id, ContentDocumentId FROM ContentVersion LIMIT 1];
        Test.startTest();
        PdfEditorController.SaveResult first = PdfEditorController.saveNewVersion(account.Id, source.Id, pdf(), 'request-00000000010');
        PdfEditorController.SaveResult retry = PdfEditorController.saveNewVersion(account.Id, source.Id, pdf(), 'request-00000000010');
        Test.stopTest();
        System.assertEquals(first.versionId, retry.versionId);
        System.assertEquals(source.ContentDocumentId, first.documentId, 'The edit is a version of the same file');
        System.assertEquals(2, [SELECT count() FROM ContentVersion WHERE ContentDocumentId = :source.ContentDocumentId]);
        System.assert([SELECT IsLatest FROM ContentVersion WHERE Id = :first.versionId].IsLatest);
        System.assertEquals(1, [SELECT count() FROM ContentDocumentLink WHERE ContentDocumentId = :source.ContentDocumentId AND LinkedEntityId = :account.Id]);
    }

    @IsTest
    static void refusesANewVersionFromAnOutdatedSource() {
        Account account = [SELECT Id FROM Account LIMIT 1];
        ContentVersion source = [SELECT Id FROM ContentVersion LIMIT 1];
        PdfEditorController.saveNewVersion(account.Id, source.Id, pdf(), 'request-00000000011');
        try {
            PdfEditorController.saveNewVersion(account.Id, source.Id, pdf(), 'request-00000000012');
            System.assert(false, 'An outdated source must not overwrite a newer version');
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('nouvelle version')); }
    }

    @IsTest
    static void rejectsUnlinkedSourceAndBadPayload() {
        Account other = new Account(Name = 'Autre');
        insert other;
        ContentVersion source = [SELECT Id FROM ContentVersion LIMIT 1];
        try {
            PdfEditorController.loadSmallPdf(other.Id, source.Id);
            System.assert(false, 'A source linked elsewhere must not load');
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('lié')); }
        try {
            PdfEditorController.saveCopy(other.Id, null, 'Copie', 'not a pdf', 'request-00000000002');
            System.assert(false, 'Invalid PDF must fail');
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('PDF')); }
        System.assertEquals(0, [SELECT count() FROM PDF_Edit_Operation__c WITH SYSTEM_MODE]);
    }

    @IsTest
    static void rejectsChangedRequestAndOversizeInput() {
        Account account = [SELECT Id FROM Account LIMIT 1];
        PdfEditorController.saveCopy(account.Id, null, 'Copie', pdf(), 'request-00000000003');
        try {
            PdfEditorController.saveCopy(account.Id, null, 'Autre copie', pdf(), 'request-00000000003');
            System.assert(false, 'A reused request cannot represent another save');
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('autre contenu')); }
        String oversized = 'JVBERi0' + 'a'.repeat(1333337);
        try {
            PdfEditorController.saveCopy(account.Id, null, 'Copie', oversized, 'request-00000000004');
            System.assert(false, 'Size gate must run before decoding');
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('1 Mo')); }
    }

    @IsTest
    static void rejectsMissingRecordAndWrongIdentifiers() {
        Account account = [SELECT Id FROM Account LIMIT 1];
        try {
            PdfEditorController.listRecordPdfs(null);
            System.assert(false);
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('enregistrement')); }
        try {
            PdfEditorController.loadSmallPdf(account.Id, account.Id);
            System.assert(false);
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('Version')); }
        try {
            PdfEditorController.saveCopy(account.Id, null, 'dossier/copie', pdf(), 'request-00000000005');
            System.assert(false);
        } catch (AuraHandledException error) { System.assert(error.getMessage().contains('nom')); }
    }

    @IsTest
    static void nonAdminCannotReadAnUnsharedFile() {
        Profile profile = [SELECT Id FROM Profile WHERE UserLicense.Name = 'Salesforce' AND PermissionsModifyAllData = false LIMIT 1];
        User reader = new User(Alias = 'pdfread', Email = 'pdf-test@example.invalid', LastName = 'PDF Test',
            Username = 'pdf-test-' + System.now().getTime() + '@example.invalid', ProfileId = profile.Id,
            TimeZoneSidKey = 'Europe/Paris', LocaleSidKey = 'fr_FR', EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'fr');
        System.runAs(new User(Id = UserInfo.getUserId())) { insert reader; }
        ContentVersion privateFile = new ContentVersion(Title = 'Private', PathOnClient = 'private.pdf', VersionData = Blob.valueOf('%PDF-1.4\n%%EOF'));
        insert privateFile;
        System.runAs(reader) {
            Boolean refused = false;
            try { PdfEditorController.loadSmallPdf(reader.Id, privateFile.Id); }
            catch (Exception error) { refused = true; }
            System.assert(refused, 'A non-admin must never receive another user’s private file');
        }
    }
}
