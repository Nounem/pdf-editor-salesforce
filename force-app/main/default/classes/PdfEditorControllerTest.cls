@IsTest
private class PdfEditorControllerTest {
    private static String pdf() { return EncodingUtil.base64Encode(Blob.valueOf('%PDF-1.4\n%%EOF')); }
    @TestSetup
    static void setup() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert new PermissionSetAssignment(AssigneeId = UserInfo.getUserId(), PermissionSetId = [SELECT Id FROM PermissionSet WHERE Name = 'PDF_Editor_User' LIMIT 1].Id);
        }
        Account account = new Account(Name = 'LovePdf test');
        insert account;
        insert new ContentVersion(Title = 'Source', PathOnClient = 'source.pdf', VersionData = Blob.valueOf('%PDF-1.4\n%%EOF'), FirstPublishLocationId = account.Id);
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
