# Cancelamento de bilhetes e reembolsos

Pedidos de cancelamento são permitidos até três horas antes do início da sessão. O comprador confirma com a senha da conta, informa o motivo e o bilhete é revogado imediatamente. Se o pedido for rejeitado, o bilhete é reativado com um QR novo.

O pedido passa por análise do vendedor, decisão do organizador, validação da plataforma, registo do pagamento pelo organizador e confirmação final da plataforma. O organizador regista o recebedor, o meio, a data e as notas ou referência de prova. O comprador vê o estado do pedido em **A minha conta**; reembolsos confirmados aparecem como concluídos com os dados registados.

Análises sem resposta são escaladas após 24 horas: vendedor para organizador e organizador para plataforma. A aplicação também executa a escalada quando as páginas de conta/reembolsos são consultadas. Para executar a escalada mesmo sem acessos às páginas, configure `CRON_SECRET` e agende uma chamada GET a `/api/cron/refunds/escalate` com o cabeçalho `Authorization: Bearer <CRON_SECRET>` a cada cinco minutos.
