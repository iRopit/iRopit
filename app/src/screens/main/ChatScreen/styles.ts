import { StyleSheet } from 'react-native';
import { ColorTheme } from '../../../theme/colors';

export const createStyles = (colors: ColorTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerSpacer: {
      paddingTop: 50,
    },
    titleContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    deleteAllButton: {
      padding: 8,
    },
    title: {
      fontSize: 34,
      fontWeight: 'bold',
    },
    typingText: {
      fontSize: 14,
      marginTop: 4,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
    },
    emptyIcon: {
      fontSize: 64,
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '600',
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 16,
      textAlign: 'center',
    },
    emptyListContent: {
      flex: 1,
    },
    senderName: {
      fontSize: 12,
      marginBottom: 4,
    },
    messagesList: {
      padding: 16,
      flexGrow: 1,
    },
    messageWrapper: {
      marginBottom: 12,
      alignItems: 'flex-start',
      alignSelf: 'flex-start',
    },
    myMessageWrapper: {
      alignItems: 'flex-end',
      alignSelf: 'flex-end',
    },
    messageBubble: {
      maxWidth: '75%',
      padding: 12,
      borderRadius: 16,
    },
    messageText: {
      fontSize: 16,
      marginBottom: 4,
    },
    messageTime: {
      fontSize: 11,
      alignSelf: 'flex-end',
    },
    replyContainer: {
      flexDirection: 'row',
      marginBottom: 4,
      padding: 8,
      borderRadius: 8,
      maxWidth: '75%',
    },
    replyBar: {
      width: 3,
      marginRight: 8,
      borderRadius: 2,
    },
    replyText: {
      fontSize: 14,
      flex: 1,
    },
    replyPreview: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderTopWidth: 1,
    },
    replyLabel: {
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 4,
    },
    replyPreviewText: {
      fontSize: 14,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: 8,
      paddingBottom: 6,
    },
    attachButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 20,
      marginRight: 8,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonText: {
      color: colors.textInverse,
      fontSize: 20,
      fontWeight: 'bold',
    },
    chatImage: {
      width: 200,
      height: 200,
      borderRadius: 12,
      marginBottom: 4,
    },
    imageDownloadBtn: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    fileLink: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      borderRadius: 8,
      marginBottom: 4,
      gap: 8,
    },
    fileName: {
      fontSize: 14,
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 12,
      fontSize: 16,
    },
  });

export const styles = createStyles(
  require('../../../theme/colors').LIGHT_COLORS,
);
